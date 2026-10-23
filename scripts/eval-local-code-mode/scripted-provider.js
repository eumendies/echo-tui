// 这些确定性 provider 只验证评测管线，不代表任何真实模型的正确率或 token 成本。
// 答案必须由真实工具返回数据计算；不得读取 fixtures 的 expected 或宿主文件。
const READ_JSON = `async function readJSON(path) {
  const r = await tools.read_files({files:[{path}]});
  if (!r.ok) throw Error(JSON.stringify(r.error));
  return JSON.parse(r.data.files[0].content);
}`;
const SCRIPTS = {
  'simple-query': `const r = await tools.grep({pattern:'needle',paths:['notes.txt']});
    if (!r.ok || r.data.has_more) throw Error('incomplete');
    return {line:r.data.matches[0].line,column:r.data.matches[0].column};`,
  'cross-file-filter': `${READ_JSON}
    const services = await readJSON('services.json'); const ids = [];
    for (const s of services) if (s.enabled && (await readJSON(s.file)).errors >= 2) ids.push(s.id);
    return {ids:ids.sort()};`,
  'dependent-branch': `${READ_JSON}
    const route = await readJSON('route.json'); return await readJSON(route.active);`,
  aggregation: `${READ_JSON}
    const rows = await readJSON('ledger.json'); const totals = {};
    for (const row of rows) totals[row.team] = (totals[row.team] || 0) + row.amount;
    return {totals};`,
  'no-match': `const r = await tools.glob({pattern:'absent/**/*.txt'});
    if (!r.ok) throw Error(JSON.stringify(r.error)); return {paths:r.data.paths,incomplete:r.data.has_more};`,
  'partial-failure': `const r = await tools.read_files({files:[{path:'empty.txt'},{path:'missing.txt'},{path:'services.json'}]});
    const f = r.data.files; return {emptyLines:f[0].returned_lines,
      serviceCount:JSON.parse(f[2].content).length,missing:f.filter(x=>!x.ok).map(x=>x.path).sort()};`,
  'pagination-truncation': `let offset = 0, sum = 0, lines = 0;
    while (true) {
      const r = await tools.read_files({files:[{path:'numbers.txt',offset,limit:3}]});
      if (!r.ok) throw Error(JSON.stringify(r.error)); const f = r.data.files[0];
      for (const line of f.content.split(String.fromCharCode(10)).filter(Boolean)) {sum += Number(line); lines++;}
      if (!f.has_more) break;
      if (f.next_offset === null) throw Error('unsafe resume'); offset = f.next_offset;
    }
    const r = await tools.read_files({files:[{path:'long.txt',limit:1}]}); const f = r.data.files[0];
    return {sum,lines,longLineIncomplete:f.content_truncated,safeResume:f.next_offset !== null && f.next_offset > f.offset};`,
  'list-truncation': `const first = await tools.glob({pattern:'bulk/*.txt'});
    const a = await tools.glob({pattern:'bulk/a*.txt'}); const b = await tools.glob({pattern:'bulk/b*.txt'});
    if (!first.ok || !a.ok || !b.ok || a.data.has_more || b.data.has_more) throw Error('incomplete');
    return {initialIncomplete:first.data.has_more,count:a.data.paths.length+b.data.paths.length};`,
  'script-repair': `${READ_JSON} return {serviceCount:(await readJSON('services.json')).length};`
};
const BROKEN_SCRIPT = 'return (await tools.read_files({files:[{path:"services.json"}]})).files[0].content;';

function call(toolName, args, callId) {
  return {
    toolName,
    argumentsText: JSON.stringify(args),
    callId
  };
}

function createScriptedProvider(task, group) {
  let turn = 0;
  if (group !== 'native') {
    return {
      async runTurn(records) {
        turn += 1;
        const results = records.filter((record) => record.role === 'tool_result' && record.toolName === 'run_code');
        if (results.length === 0 || (task.id === 'script-repair' && results.length === 1)) {
          const code = task.id === 'script-repair' && results.length === 0 ? BROKEN_SCRIPT : SCRIPTS[task.id];
          return {
            draft: '',
            toolCalls: [
              call(
                'run_code',
                {
                  code
                },
                `script-${turn}`
              )
            ]
          };
        }
        const result = JSON.parse(results.at(-1).text);
        return {
          draft: JSON.stringify(result.result),
          toolCalls: []
        };
      }
    };
  }

  // 原生路径消费既有展示文本是 provider 行为；脚本桥接从不解析该通道。
  const reads = [];
  const read = (file, extra = {}) =>
    call(
      'read_files',
      {
        files: [
          {
            path: file,
            ...extra
          }
        ]
      },
      `read-${reads.push(file)}`
    );
  const plans = {
    'simple-query': () => [read('notes.txt')],
    'cross-file-filter': () => [read('services.json')],
    'dependent-branch': () => [read('route.json')],
    aggregation: () => [read('ledger.json')],
    'no-match': () => [
      call(
        'glob',
        {
          pattern: 'absent/**/*.txt'
        },
        'empty-glob'
      )
    ],
    'partial-failure': () => [
      call(
        'read_files',
        {
          files: [
            {
              path: 'empty.txt'
            },
            {
              path: 'missing.txt'
            },
            {
              path: 'services.json'
            }
          ]
        },
        'partial'
      )
    ],
    'pagination-truncation': () => [
      read('numbers.txt', {
        offset: 0,
        limit: 3
      })
    ],
    'list-truncation': () => [
      call(
        'glob',
        {
          pattern: 'bulk/*.txt'
        },
        'first-list'
      )
    ],
    'script-repair': () => [read('services.json')]
  };
  const next = plans[task.id]();
  const contents = new Map();
  const nativeContent = (text) =>
    [...text.matchAll(/^\d+ │ (.*)$/gm)]
      .map((match) => match[1])
      .join('\n');
  return {
    async runTurn(records) {
      turn += 1;
      if (turn === 1) {
        return {
          draft: '',
          toolCalls: next
        };
      }
      const results = records.filter((record) => record.role === 'tool_result');
      if (task.id !== 'partial-failure' && results.some((result) => !result.ok)) {
        throw Error('Native query failed; do not substitute empty success');
      }
      for (const result of results) {
        const name = reads[Number(result.toolCallId?.replace('read-', '')) - 1];
        if (name) {
          contents.set(result.toolCallId, nativeContent(result.text));
        }
      }
      const json = (name) => JSON.parse(contents.get(`read-${reads.indexOf(name) + 1}`));
      let answer;
      switch (task.id) {
        case 'simple-query': {
          const text = contents.get('read-1');
          const lines = text.split('\n');
          const line = lines.findIndex((value) => value.includes('needle'));
          answer = {
            line: line + 1,
            column: Buffer.byteLength(lines[line].slice(0, lines[line].indexOf('needle'))) + 1
          };
          break;
        }
        case 'cross-file-filter': {
          const services = json('services.json').filter((service) => service.enabled);
          if (results.length === 1) {
            return {
              draft: '',
              toolCalls: services.map((service) => read(service.file))
            };
          }
          answer = {
            ids: services
              .filter((service) => json(service.file).errors >= 2)
              .map((service) => service.id)
              .sort()
          };
          break;
        }
        case 'dependent-branch': {
          const name = json('route.json').active;
          if (results.length === 1) {
            return {
              draft: '',
              toolCalls: [read(name)]
            };
          }
          answer = json(name);
          break;
        }
        case 'aggregation': {
          const totals = {};
          for (const row of json('ledger.json')) {
            totals[row.team] = (totals[row.team] || 0) + row.amount;
          }
          answer = {
            totals
          };
          break;
        }
        case 'no-match':
          answer = {
            paths: [...results[0].text.matchAll(/^.*\/absent\/.*\.txt$/gm)].map((match) => match[0]),
            incomplete: /truncat|has_more: true/i.test(results[0].text)
          };
          break;
        case 'partial-failure': {
          const text = results[0].text;
          const blocks = text.split(/(?=^--- text: )/m);
          const empty = blocks.find((block) => block.startsWith('--- text: empty.txt\n'));
          const services = blocks.find((block) => block.startsWith('--- text: services.json\n'));
          const missing = blocks.find((block) => block.startsWith('--- text: missing.txt\n'));
          if (!empty || !services || !missing || /error:/.test(empty + services)) {
            throw Error('Missing successful native batch items');
          }
          answer = {
            emptyLines: [...empty.matchAll(/^\d+ │ /gm)].length,
            serviceCount: JSON.parse(nativeContent(services)).length,
            missing: /(ENOENT|not found|no such file)/i.test(missing) ? ['missing.txt'] : []
          };
          break;
        }
        case 'pagination-truncation': {
          if (results.length < 4) {
            return {
              draft: '',
              toolCalls: [
                read('numbers.txt', {
                  offset: results.length * 3,
                  limit: 3
                })
              ]
            };
          }
          if (results.length === 4) {
            return {
              draft: '',
              toolCalls: [
                read('long.txt', {
                  limit: 1
                })
              ]
            };
          }
          const values = [...contents.values()]
            .slice(0, 4)
            .join('\n')
            .split('\n')
            .filter(Boolean)
            .map(Number);
          answer = {
            sum: values.reduce((sum, value) => sum + value, 0),
            lines: values.length,
            longLineIncomplete: /truncat/i.test(results.at(-1).text),
            safeResume: false
          };
          break;
        }
        case 'list-truncation': {
          if (results.length === 1) {
            return {
              draft: '',
              toolCalls: [
                call(
                  'glob',
                  {
                    pattern: 'bulk/a*.txt'
                  },
                  'a-list'
                ),
                call(
                  'glob',
                  {
                    pattern: 'bulk/b*.txt'
                  },
                  'b-list'
                )
              ]
            };
          }
          const paths = results
            .slice(1)
            .flatMap((result) =>
              result.text
                .split('\n')
                .filter((line) => /[/\\]bulk[/\\][ab]\d+\.txt$/.test(line))
            );
          answer = {
            initialIncomplete: /truncat|has_more: true/i.test(results[0].text),
            count: paths.length
          };
          break;
        }
        case 'script-repair':
          answer = {
            serviceCount: json('services.json').length
          };
          break;
      }
      return {
        draft: JSON.stringify(answer),
        toolCalls: []
      };
    }
  };
}

module.exports = {
  createScriptedProvider,
  SCRIPTS,
  BROKEN_SCRIPT
};
