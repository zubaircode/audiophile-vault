import test from 'node:test';
import assert from 'node:assert/strict';

function validateBounds(state, displays) {
  if (state.x === undefined || state.y === undefined) {
    return { ...state, x: undefined, y: undefined };
  }

  const windowBounds = {
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
  };

  const centerX = windowBounds.x + windowBounds.width / 2;
  const centerY = windowBounds.y + windowBounds.height / 2;

  const isVisible = displays.some((display) => {
    const { x, y, width, height } = display.bounds;
    const centerInside =
      centerX >= x &&
      centerX <= x + width &&
      centerY >= y &&
      centerY <= y + height;
    if (centerInside) return true;

    const intersects =
      windowBounds.x < x + width &&
      windowBounds.x + windowBounds.width > x &&
      windowBounds.y < y + height &&
      windowBounds.y + windowBounds.height > y;
    return intersects;
  });

  if (!isVisible) {
    return { ...state, x: undefined, y: undefined };
  }

  return state;
}

test('validateBounds retains coordinates within single active display', () => {
  const displays = [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }];
  const state = { width: 1360, height: 860, x: 100, y: 100, isFullScreen: false };
  const validated = validateBounds(state, displays);
  assert.equal(validated.x, 100);
  assert.equal(validated.y, 100);
});

test('validateBounds resets coordinates when disconnected external monitor coordinates are out of bounds', () => {
  const displays = [{ bounds: { x: 0, y: 0, width: 1440, height: 900 } }];
  // Window was saved on external 4K monitor at x: 2560, y: 400
  const state = { width: 1360, height: 860, x: 2560, y: 400, isFullScreen: false };
  const validated = validateBounds(state, displays);
  assert.equal(validated.x, undefined);
  assert.equal(validated.y, undefined);
  assert.equal(validated.width, 1360);
  assert.equal(validated.height, 860);
});

test('validateBounds detects multi-monitor secondary display bounds correctly', () => {
  const displays = [
    { bounds: { x: 0, y: 0, width: 1440, height: 900 } },
    { bounds: { x: 1440, y: 0, width: 2560, height: 1440 } },
  ];
  const state = { width: 1360, height: 860, x: 1600, y: 200, isFullScreen: false };
  const validated = validateBounds(state, displays);
  assert.equal(validated.x, 1600);
  assert.equal(validated.y, 200);
});
