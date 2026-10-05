import './confirm-report-pages.css';

let active = false;
export function confirmReportPages(count: number, source: 'HWP' | 'PDF', signal: AbortSignal): Promise<boolean> {
  return confirmAppAction('보고서 전체 페이지 적용', `현재 보고서 전체를 선택한 ${source} ${count}쪽의 페이지 이미지로 교체할까요? 갑지·목차·사진·쪽번호를 포함합니다. 문장·표 개별 편집은 원본에서 해야 하며, 다른 사건 자료가 현재 사건 사실로 바뀌지는 않습니다.`, `${count}쪽 전체 적용`, signal, '취소 · 기존 원고 유지');
}

export function confirmAppAction(title: string, message: string, confirmLabel: string, signal: AbortSignal, cancelLabel = '취소 · 기존 상태 유지'): Promise<boolean> {
  if (active || signal.aborted) return Promise.resolve(false);
  active = true;
  return new Promise(resolve => {
    const previous = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'report-page-confirm';
    const heading = document.createElement('h2'); heading.id = 'report-page-confirm-title'; heading.textContent = title;
    const description = document.createElement('p'); description.id = 'report-page-confirm-description';
    description.textContent = message;
    dialog.setAttribute('aria-labelledby', heading.id); dialog.setAttribute('aria-describedby', description.id);
    const form = document.createElement('form'); form.method = 'dialog';
    const cancel = document.createElement('button'); cancel.type = 'submit'; cancel.value = 'cancel'; cancel.textContent = cancelLabel; cancel.autofocus = true;
    const confirm = document.createElement('button'); confirm.type = 'submit'; confirm.value = 'confirm'; confirm.textContent = confirmLabel; confirm.className = 'is-primary';
    form.append(cancel, confirm); dialog.append(heading, description, form);
    let finished = false;
    const finish = (accepted: boolean) => {
      if (finished) return;
      finished = true; active = false;
      signal.removeEventListener('abort', abort); window.removeEventListener('pagehide', abort); window.removeEventListener('popstate', abort);
      dialog.remove();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
      resolve(accepted);
    };
    const abort = () => finish(false);
    dialog.addEventListener('close', () => finish(dialog.returnValue === 'confirm'), { once: true });
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); }, { once: true });
    signal.addEventListener('abort', abort, { once: true }); window.addEventListener('pagehide', abort, { once: true }); window.addEventListener('popstate', abort, { once: true });
    document.body.append(dialog);
    try { dialog.showModal(); cancel.focus(); } catch { finish(false); }
  });
}
