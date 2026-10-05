/** Render the selected PDF itself; never infer that a same-named HWP is identical. */
export async function openPdfPageImages(bytes: Uint8Array) {
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(bytes, { useSystemFonts: false, stopAtErrors: true });
  try {
    // Validate every page before any project upload or body replacement.
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const { width, height } = page.getViewport({ scale: 1 });
      if (!(height > width && Math.abs(width / height - 210 / 297) < .025)) throw new Error(`PDF ${number}쪽이 A4 세로가 아닙니다. 원본을 확인하세요. 기존 보고서는 유지합니다.`);
      page.cleanup();
    }
    return {
      count: pdf.numPages,
      close: () => pdf.loadingTask.destroy(),
      async readPage(index: number): Promise<File> {
        const page = await pdf.getPage(index + 1);
        const viewport = page.getViewport({ scale: 1588 / page.getViewport({ scale: 1 }).width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        try {
          const context = canvas.getContext('2d');
          if (!context) throw new Error('PDF 페이지를 표시할 캔버스를 만들지 못했습니다.');
          await page.render({ canvas, canvasContext: context, viewport, background: '#ffffff' }).promise;
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PDF 페이지 이미지 생성 실패')), 'image/jpeg', .94));
          return new File([blob], `report-pdf-page-${index + 1}.jpg`, { type: 'image/jpeg' });
        } finally { page.cleanup(); canvas.width = 0; canvas.height = 0; }
      }
    };
  } catch (error) { await pdf.loadingTask.destroy(); throw error; }
}
