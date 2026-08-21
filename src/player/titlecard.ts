// The title card announces, then gets out of the way.
//
// It is there to tell you who is speaking and what they are on. Once you know,
// it is furniture standing over somebody's face, so it goes. Every cut brings
// it back, because at a cut the answer has changed, and so does any movement
// of the pointer, because that is somebody asking where they are.

const HOLD = 8000;   // how long the answer stays up
const WAKE = 2500;   // and how long a passing pointer earns it

export function makeTitleCard(root: HTMLElement): { show(ms?: number): void } {
  const bar = root.querySelector<HTMLElement>(".titlebar");
  let timer: number | undefined;

  function show(ms: number = HOLD): void {
    if (!bar) return;
    bar.classList.remove("is-faded");
    clearTimeout(timer);
    timer = window.setTimeout(() => bar.classList.add("is-faded"), ms);
  }

  root.addEventListener("pointermove", () => show(WAKE));
  show();
  return { show };
}
