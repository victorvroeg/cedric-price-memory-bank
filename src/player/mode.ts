// Which way are you moving through the archive?
//
// There are two, and they are the whole idea: along a theme, where the
// speakers change under you, or along a speaker, where the themes do. Until
// now that was something a visitor had to infer from which edge was lit.
//
// The two edges already name the theme and the speaker, and the rule says
// which of them you are on. So this adds only what is missing: the way across
// to the other axis, and — the first couple of times — a line announcing the
// change, because the idea is easier to catch once than to deduce twice.

export interface Mode {
  /** "theme": speakers change under a fixed theme. "speaker": the reverse. */
  kind: "theme" | "speaker";
  base: string;
  theme: { slug: string; label: string; colour: string };
  speaker: { slug: string; name: string };
  /** where to pick the film up from, when crossing to the other axis */
  at(): number;
}

const SEEN = "cpmb-mode-explained";
const ANNOUNCE_TIMES = 2;

export function makeMode(root: HTMLElement, m: Mode): { update(): void } {
  const refresh = switcher(root, m);
  announce(root, m);
  return { update: refresh };
}

function switcher(root: HTMLElement, m: Mode): () => void {
  const el = root.querySelector<HTMLElement>(".modeswitch");
  if (!el) return () => {};

  // The theme is on the left edge, the speaker on the right, and the rule says
  // which one you are on. None of that needs saying again here. What is not
  // anywhere on screen is the way across, so that is all this is.
  el.textContent = "";
  const a = document.createElement("a");
  a.className = "modeswitch__cross";
  const verb = document.createElement("span");
  verb.className = "modeswitch__verb";
  const what = document.createElement("span");
  what.className = "modeswitch__value";
  a.append(verb, what);
  el.appendChild(a);

  const toSpeaker = () =>
    `${m.base}/interview/${m.speaker.slug}/?mode=1#t=${m.at().toFixed(1)}`;
  const toTheme = () => `${m.base}/topic/${m.theme.slug}/?mode=1&from=${m.speaker.slug}`;

  const paint = (): void => {
    if (m.kind === "theme") {
      verb.textContent = "follow";
      what.textContent = m.speaker.name;
      what.style.color = "";
      a.title = `watch ${m.speaker.name}'s whole interview from here`;
      a.href = toSpeaker();
    } else {
      verb.textContent = "follow";
      what.textContent = m.theme.label;
      what.style.color = m.theme.colour;
      a.title = `hear everyone on ${m.theme.label}`;
      a.href = toTheme();
    }
  };
  paint();
  a.addEventListener("pointerdown", paint);
  a.addEventListener("focus", paint);
  return paint;
}

function announce(root: HTMLElement, m: Mode): void {
  const el = root.querySelector<HTMLElement>(".modesay");
  if (!el) return;

  const arrivedBySwitch = new URLSearchParams(location.search).has("mode");
  let seen = 0;
  try {
    seen = Number(sessionStorage.getItem(SEEN) ?? 0);
  } catch { /* private browsing */ }
  if (!arrivedBySwitch && seen >= ANNOUNCE_TIMES) return;
  try {
    sessionStorage.setItem(SEEN, String(seen + 1));
  } catch { /* ignore */ }

  el.innerHTML = "";
  const lead = document.createElement("span");
  lead.className = "modesay__lead";
  lead.textContent = "now following";
  const what = document.createElement("span");
  what.className = "modesay__what";
  if (m.kind === "theme") {
    what.textContent = m.theme.label;
    what.style.color = m.theme.colour;
  } else {
    what.textContent = m.speaker.name;
  }
  el.append(lead, what);
  el.hidden = false;
  el.classList.add("is-on");
  setTimeout(() => el.classList.remove("is-on"), 2600);
  setTimeout(() => (el.hidden = true), 3400);
}
