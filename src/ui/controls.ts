/** 하나만 고르는 칩 묶음. setActive로 선택 표시를 바꾼다 */
export function chips(
  container: HTMLElement,
  items: { id: string; name: string }[],
  onPick: (id: string) => void,
): { setActive: (id: string) => void } {
  container.innerHTML = '';
  const buttons = items.map((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = item.name;
    b.dataset.id = item.id;
    b.addEventListener('click', () => onPick(item.id));
    container.appendChild(b);
    return b;
  });
  return {
    setActive: (id) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id))),
  };
}

/**
 * [data-popover="id"] 버튼을 누르면 해당 패널을 열고 닫는다.
 * 한 번에 하나만 열리고, 바깥을 누르거나 Esc를 누르면 닫힌다.
 */
export function popovers() {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-popover]')];
  const panel = (b: HTMLButtonElement) => document.getElementById(b.dataset.popover!)!;
  const close = () =>
    buttons.forEach((b) => {
      panel(b).hidden = true;
      b.setAttribute('aria-expanded', 'false');
    });

  for (const b of buttons) {
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = panel(b).hidden;
      close();
      panel(b).hidden = !opening;
      b.setAttribute('aria-expanded', String(opening));
    });
    panel(b).addEventListener('click', (e) => e.stopPropagation());
  }
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}
