// Which way are you moving through the archive?
//
// There are two, and they are the whole idea: along a theme, where the
// speakers change under you, or along a speaker, where the themes do.
//
// The two edges already name the theme and the speaker, and the rule says
// which of them you are on. So this adds only what is missing: the way across.
// Crossing does not load a page. The film keeps running and the surroundings
// change around it, because the thing you were listening to is the reason you
// crossed, and taking it away to fetch a new page is taking away the reason.

export interface ModeView {
  kind(): "theme" | "speaker";
  /** the theme running right now, whether or not it is the one being followed */
  theme(): { slug: string; label: string; colour: string } | null;
  speaker(): { slug: string; name: string };
  /** cross to the other axis, in place */
  cross(): void;
}

const SEEN = "cpmb-mode-explained";
const ANNOUNCE_TIMES = 2;

export function makeMode(root: HTMLElement, view: ModeView): { update(): void; say(): void } {
  const el = root.querySelector<HTMLElement>(".modeswitch");
  const said = root.querySelector<HTMLElement>(".modesay");
  let timers: number[] = [];

  const button = document.createElement("button");
  button.type = "button";
  button.className = "modeswitch__cross";
  const verb = document.createElement("span");
  verb.className = "modeswitch__verb";
  const what = document.createElement("span");
  what.className = "modeswitch__value";
  button.append(verb, what);
  button.addEventListener("click", () => view.cross());
  el?.replaceChildren(button);

  function update(): void {
    // No names here. Both of them are already set down the edges, and naming
    // one again put the same two words on screen three times over. This says
    // only what the click gets you; the theme's colour does the pointing.
    if (view.kind() === "theme") {
      const s = view.speaker();
      verb.textContent = "hear";
      what.textContent = "this whole interview";
      what.style.color = "";
      button.title = `${s.name}'s whole interview, carrying on from here`;
      button.disabled = false;
    } else {
      const t = view.theme();
      verb.textContent = "hear";
      what.textContent = "everyone on this theme";
      what.style.color = t?.colour ?? "";
      button.title = t ? `everyone in the archive on ${t.label}` : "";
      button.disabled = !t;
    }
  }

  // Said out loud the first couple of times, and every time somebody crosses:
  // the idea is easier to catch once than to deduce twice.
  function say(force = false): void {
    if (!said) return;
    let seen = 0;
    try { seen = Number(sessionStorage.getItem(SEEN) ?? 0); } catch { /* private */ }
    if (!force && seen >= ANNOUNCE_TIMES) return;
    try { sessionStorage.setItem(SEEN, String(seen + 1)); } catch { /* ignore */ }

    const lead = document.createElement("span");
    lead.className = "modesay__lead";
    lead.textContent = "now following";
    const value = document.createElement("span");
    value.className = "modesay__what";
    if (view.kind() === "theme") {
      const t = view.theme();
      value.textContent = t?.label ?? "";
      value.style.color = t?.colour ?? "";
    } else {
      value.textContent = view.speaker().name;
    }
    said.replaceChildren(lead, value);
    said.hidden = false;
    said.classList.add("is-on");
    for (const t of timers) clearTimeout(t);
    timers = [
      window.setTimeout(() => said.classList.remove("is-on"), 2600),
      window.setTimeout(() => (said.hidden = true), 3400),
    ];
  }

  update();
  say();
  return { update, say: () => say(true) };
}
