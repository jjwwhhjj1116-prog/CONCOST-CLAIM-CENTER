import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
export const html2canvasSource = require.resolve('html2canvas/dist/html2canvas.esm.js');
const sourceVersion = require('html2canvas/package.json').version;
const sourceHashes = new Set([
  'c3b0b8b257996d79b5e362d2aee2411ff74fd23e984e9900f5ba005ea4753d64',
  // Vite dev masks only the final sourceMappingURL comment with spaces.
  '0aeb87cf1d3a254f300466dbed0f78c1610ec2d4a536cad69e3b6cdec8ac6f6f'
]);
const anchor = "        container.style.whiteSpace = 'nowrap';\n";

export const stablePdfFontMetrics = (): Plugin => ({
  name: 'stable-pdf-font-metrics',
  enforce: 'pre',
  transform(code, id) {
    if (id.split('?')[0].replaceAll('\\', '/') !== html2canvasSource.replaceAll('\\', '/')) return null;
    if (sourceVersion !== '1.4.1' || !sourceHashes.has(createHash('sha256').update(code).digest('hex')) || code.split(anchor).length !== 2) {
      this.error('html2canvas 1.4.1 PDF 측정 패치의 원본이 달라졌습니다. 출력 회귀검사 후 지문을 갱신해야 합니다.');
    }
    // Keep the invisible font probe out of page flow. Its two offsetTop values
    // then share a local origin, independent of the surrounding authoring UI.
    let patched = code.replace(anchor, anchor + "        container.style.position = 'absolute';\n        container.style.top = '0';\n        container.style.left = '0';\n");
    // The canvas already translates by -pageY. Round decoration positions
    // relative to that page, rather than to the surrounding document.
    for (const [original, replacement] of [
      ['Math.round(text.bounds.top + baseline)', 'Math.round(text.bounds.top + baseline - _this.options.y) + _this.options.y'],
      ['Math.round(text.bounds.top)', 'Math.round(text.bounds.top - _this.options.y) + _this.options.y'],
      ['Math.ceil(text.bounds.top + middle)', 'Math.ceil(text.bounds.top + middle - _this.options.y) + _this.options.y']
    ]) {
      if (patched.split(original).length !== 2) this.error('PDF 장식선 좌표 패치 지점이 달라졌습니다. 출력 회귀검사가 필요합니다.');
      patched = patched.replace(original, replacement);
    }
    return patched;
  }
});
