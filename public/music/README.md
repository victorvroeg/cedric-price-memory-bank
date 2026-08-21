# The bed

Drop audio files here (`.mp3`, `.m4a`, `.aac`, `.ogg`, `.wav`) and they become
the music the tool plays under the cross-cuts. There is no list to update — the
build reads this folder.

How it behaves, per topic page:

- one piece per topic, chosen from this folder deterministically by topic slug,
  so a topic keeps its theme between visits
- it comes up while the first film buffers, and while any later film buffers
- it ducks to a whisper under the talking and rises again in the dark of a cut
- it fades out over five seconds when the cross-cut ends
- the visitor can switch it off with the ♪ control; the choice is remembered

Practical notes:

- **Loop cleanly.** The piece loops for as long as the topic runs. A piece that
  thumps at the seam will be heard thumping many times.
- **Keep it small.** These files ship from GitHub Pages with the site, not from
  Cloudflare Stream. 128 kbps mono or stereo is plenty for a bed; aim under
  ~4 MB per piece.
- **Leave room in the middle.** The bed sits under speech at about 5% gain.
  Music with a lot of energy at 200 Hz–3 kHz will fight the voices even there.

## Licence

Write down, in `CREDITS.md` beside the files, what each piece is, who wrote it,
and on what terms this archive may use it. The 2014 site died partly of
paperwork nobody could find. Do not repeat it.
