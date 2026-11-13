import type { StoryboardShotFlag } from "../storyboardPanelState";

/** Flag glyphs shared by the storyboard filter row and the asset library annotations. */
export function StoryboardFlagIcon({ flag }: { flag: StoryboardShotFlag }) {
  if (flag === "retained") {
    return (
      <svg
        className="storyboard-flag-icon is-retained"
        viewBox="12 5 39 43"
        width="78"
        height="86"
        fill="none"
        aria-hidden="true"
      >
        <g className="storyboard-flag-strokes" strokeWidth="2">
          <path d="M 36 9 L 47.5 20.5 L 31.5 36.5" strokeLinejoin="miter" />
          <path d="M 31.5 36.5 L 40 45" />
          <path d="M 36 9 L 25.46 19.49" strokeLinecap="round" />
          <path d="M 23.34 28.35 L 31.5 36.5" strokeLinecap="round" />
          <path
            d="M 15.40 24.49 L 17.99 27.03 L 22.55 22.42"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        <path
          className="storyboard-flag-fill"
          d="M 36 11.875 L 45.125 21 L 32 34.125 L 22.875 25 Z"
        />
      </svg>
    );
  }

  if (flag === "none") {
    return (
      <svg
        className="storyboard-flag-icon is-none"
        viewBox="57 5 33 43"
        width="66"
        height="86"
        fill="none"
        aria-hidden="true"
      >
        <g
          className="storyboard-flag-strokes"
          strokeWidth="2"
          strokeDasharray="2.2 3.457"
          strokeDashoffset="1.1"
        >
          <path d="M 59.5 24.5 L 75.5 8.5 L 87.5 20.5 L 71.5 36.5 Z" />
          <path d="M 71.5 36.5 L 80.6 45.6" />
        </g>
      </svg>
    );
  }

  return (
    <svg
      className="storyboard-flag-icon is-excluded"
      viewBox="94 5 36 43"
      width="72"
      height="86"
      fill="none"
      aria-hidden="true"
    >
      <g className="storyboard-flag-strokes" strokeWidth="2">
        <path d="M 96.79 21.81 L 103.21 28.19 M 103.21 21.81 L 96.79 28.19" />
        <path d="M 116 9 L 127.5 20.5 L 111.5 36.5" strokeLinejoin="miter" />
        <path d="M 111.5 36.5 L 120 45" />
        <path d="M 116 9 L 105.44 19.54" strokeLinecap="round" />
        <path d="M 105.24 30.19 L 111.5 36.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}
