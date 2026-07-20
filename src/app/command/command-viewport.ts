import {calculateCommandSurfaceMaxLines} from '../../render/footer';

import type {AppContext} from '../state/app-context';

type CommandViewportContext = Pick<AppContext, 'createRenderState'>;

/**
 * 根据当前终端快照计算 command surface 可用视口。
 */
function createCommandViewport(appContext: CommandViewportContext): {maxLines: number; width: number} {
  const state = appContext.createRenderState();
  return {
    maxLines: calculateCommandSurfaceMaxLines(state.rows),
    width: state.width
  };
}

export {
  createCommandViewport
};
