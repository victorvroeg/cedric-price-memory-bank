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

  // Two rows of the deck below the film, one per axis: the topic, then the
  // person. Each is a label and a value, and the deck's grid aligns them.
  // Whichever axis is not being followed is the live one: it is the way
  // across. Pinning a topic is that crossing, said in the visitor's terms.
  const topicLabel = document.createElement("span");
  topicLabel.className = "deck__label";
  const topicValue = document.createElement("button");
  topicValue.type = "button";
  topicValue.className = "deck__value modeswitch__topic";

  const whoLabel = document.createElement("span");
  whoLabel.className = "deck__label";
  const whoValue = document.createElement("button");
  whoValue.type = "button";
  whoValue.className = "deck__value modeswitch__who";

  for (const b of [topicValue, whoValue])
    b.addEventListener("click", () => { if (!b.classList.contains("is-held")) view.cross(); });
  el?.replaceChildren(topicLabel, topicValue, whoLabel, whoValue);

  /** the row for the axis being followed: a statement, not a control */
  function hold(button: HTMLButtonElement, on: boolean): void {
    button.classList.toggle("is-held", on);
    button.disabled = on;
  }

  function update(): void {
    const t = view.theme();
    const s = view.speaker();
    topicValue.textContent = t?.label ?? "";
    topicValue.style.color = t?.colour ?? "";
    whoValue.textContent = s.name;

    if (view.kind() === "theme") {
      topicLabel.textContent = "pinned topic";
      hold(topicValue, true);
      topicValue.title = `everyone in the archive on ${t?.label ?? "this topic"}`;
      whoLabel.textContent = "whole interview";
      hold(whoValue, false);
      whoValue.title = `${s.name}'s whole interview, carrying on from here`;
    } else {
      topicLabel.textContent = "pin topic";
      hold(topicValue, !t);
      topicValue.title = t ? `pin ${t.label} and hear everyone on it` : "";
      whoLabel.textContent = "whole interview";
      hold(whoValue, true);
      whoValue.title = "";
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
