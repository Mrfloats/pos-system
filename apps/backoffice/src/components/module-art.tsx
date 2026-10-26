/**
 * Colourful illustrations for the home launcher tiles. Each one is drawn on a
 * 64×64 grid with soft gradients so the set reads as one family.
 */

type ArtProps = { className?: string };

/** Corner points of an isometric cube whose top corner sits at (x, y). */
function cube(x: number, y: number, s: number) {
  const a = s * 0.866;
  const b = s * 0.5;
  const pts = (p: number[][]) => p.map(([px, py]) => `${px},${py}`).join(" ");
  return {
    top: pts([[x, y], [x + a, y + b], [x, y + 2 * b], [x - a, y + b]]),
    left: pts([[x - a, y + b], [x, y + 2 * b], [x, y + 2 * b + s], [x - a, y + b + s]]),
    right: pts([[x, y + 2 * b], [x + a, y + b], [x + a, y + b + s], [x, y + 2 * b + s]]),
  };
}

function Cube({ x, y, s, colors }: { x: number; y: number; s: number; colors: [string, string, string] }) {
  const c = cube(x, y, s);
  return (
    <g>
      <polygon points={c.top} fill={colors[0]} />
      <polygon points={c.left} fill={colors[1]} />
      <polygon points={c.right} fill={colors[2]} />
    </g>
  );
}

export function DashboardArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="dash-pink" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff9aa2" />
          <stop offset="1" stopColor="#f7737f" />
        </linearGradient>
        <linearGradient id="dash-blue" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3cc8ff" />
          <stop offset="1" stopColor="#1388f0" />
        </linearGradient>
        <linearGradient id="dash-red" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff5a64" />
          <stop offset="1" stopColor="#e8333f" />
        </linearGradient>
        <linearGradient id="dash-amber" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffc642" />
          <stop offset="1" stopColor="#ff8a1f" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="27" height="27" rx="4" fill="url(#dash-pink)" />
      <rect x="38" y="6" width="20" height="10" rx="4" fill="url(#dash-blue)" opacity="0.75" />
      <rect x="38" y="20" width="20" height="13" rx="4" fill="url(#dash-blue)" />
      <rect x="6" y="38" width="20" height="20" rx="4" fill="url(#dash-red)" />
      <rect x="31" y="40" width="11" height="18" rx="4" fill="url(#dash-amber)" opacity="0.8" />
      <rect x="47" y="37" width="11" height="21" rx="4" fill="url(#dash-amber)" />
    </svg>
  );
}

export function ProductsArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="prod-bag" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffab3d" />
          <stop offset="1" stopColor="#f2621f" />
        </linearGradient>
        <linearGradient id="prod-tag" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#ffbf3c" />
        </linearGradient>
      </defs>
      <path d="M21 22v-4a9 9 0 0 1 18 0v4" fill="none" stroke="#e8571a" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M10 22h40l-3 34a4 4 0 0 1-4 3.6H17a4 4 0 0 1-4-3.6z" fill="url(#prod-bag)" />
      <path d="M10 22h40l-.5 6H10.5z" fill="#fff" opacity="0.18" />
      <g transform="rotate(-18 46 40)">
        <path d="M36 30h16a3 3 0 0 1 3 3v12l-11 11-11-11V33a3 3 0 0 1 3-3z" fill="url(#prod-tag)" />
        <circle cx="44" cy="36" r="2.6" fill="#f2621f" />
      </g>
    </svg>
  );
}

export function CategoriesArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="cat-back" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6a6f0" />
          <stop offset="1" stopColor="#c46fe0" />
        </linearGradient>
        <linearGradient id="cat-front" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b47cf5" />
          <stop offset="1" stopColor="#7c4ddb" />
        </linearGradient>
      </defs>
      <path d="M14 8h18l22 22-18 18L14 26z" fill="url(#cat-back)" />
      <path d="M8 18h18l22 22-18 18L8 36z" fill="url(#cat-front)" />
      <circle cx="17" cy="27" r="3.5" fill="#fff" />
      <path d="M22 42l8-8M27 47l8-8" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

export function StockArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="stock-base" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffb24d" />
          <stop offset="1" stopColor="#f2621f" />
        </linearGradient>
      </defs>
      <polygon points="32,14 54,26 54,48 32,60 10,48 10,26" fill="url(#stock-base)" />
      <polygon points="32,14 54,26 32,38 10,26" fill="#ffcf7a" opacity="0.6" />
      <Cube x={23} y={24} s={11} colors={["#5fe0d2", "#22a99c", "#178a80"]} />
      <Cube x={41} y={24} s={11} colors={["#5fe0d2", "#22a99c", "#178a80"]} />
      <Cube x={32} y={12} s={11} colors={["#ff8fb8", "#e5487f", "#c22f66"]} />
      <path d="M48 14l9-9M50 5h7v7" fill="none" stroke="#21c4a8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 50l-9 9M7 52v7h7" fill="none" stroke="#ff8a1f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CustomersArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="cust-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7fe3d0" />
          <stop offset="1" stopColor="#20b39a" />
        </linearGradient>
        <linearGradient id="cust-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4fb4ff" />
          <stop offset="1" stopColor="#1f6fe0" />
        </linearGradient>
      </defs>
      <circle cx="43" cy="20" r="9" fill="url(#cust-back)" />
      <path d="M28 50a15 15 0 0 1 30 0v2a3 3 0 0 1-3 3H31a3 3 0 0 1-3-3z" fill="url(#cust-back)" />
      <circle cx="25" cy="23" r="11" fill="url(#cust-front)" />
      <path d="M6 54a19 19 0 0 1 38 0v2a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z" fill="url(#cust-front)" />
      <circle cx="21" cy="20" r="3" fill="#fff" opacity="0.35" />
    </svg>
  );
}

export function StaffArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="staff-card" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4cd98f" />
          <stop offset="1" stopColor="#1c9a62" />
        </linearGradient>
      </defs>
      <rect x="26" y="4" width="12" height="10" rx="3" fill="#8a96a3" />
      <rect x="9" y="10" width="46" height="48" rx="7" fill="url(#staff-card)" />
      <rect x="27" y="10" width="10" height="6" rx="2" fill="#1c6652" />
      <circle cx="32" cy="29" r="7" fill="#fff" />
      <path d="M20 47a12 12 0 0 1 24 0z" fill="#fff" />
      <rect x="20" y="50" width="24" height="3" rx="1.5" fill="#fff" opacity="0.5" />
    </svg>
  );
}

export function SettingsArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="set-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffa766" />
          <stop offset="1" stopColor="#f0682f" />
        </linearGradient>
      </defs>
      <polygon points="32,30 58,42 32,54 6,42" fill="#b8282a" />
      <polygon points="6,42 32,54 32,58 6,46" fill="#9c1f22" />
      <polygon points="32,54 58,42 58,46 32,58" fill="#861a1d" />
      <polygon points="32,22 58,34 32,46 6,34" fill="#e0483a" />
      <polygon points="6,34 32,46 32,50 6,38" fill="#c23a2e" />
      <polygon points="32,46 58,34 58,38 32,50" fill="#a83026" />
      <polygon points="32,10 58,22 32,34 6,22" fill="url(#set-top)" />
      <polygon points="6,22 32,34 32,38 6,26" fill="#e05a2a" />
      <polygon points="32,34 58,22 58,26 32,38" fill="#c84a22" />
      <ellipse cx="32" cy="22" rx="7" ry="3.5" fill="#ffd36b" />
      <g fill="#ffd9b8" opacity="0.7">
        <circle cx="20" cy="22" r="1" />
        <circle cx="44" cy="22" r="1" />
        <circle cx="32" cy="15" r="1" />
        <circle cx="32" cy="29" r="1" />
      </g>
    </svg>
  );
}

export function AccountsArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="acct-wallet" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4fb4ff" />
          <stop offset="1" stopColor="#1f6fe0" />
        </linearGradient>
        <linearGradient id="acct-coin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5cc2ff" />
          <stop offset="1" stopColor="#1a7fe8" />
        </linearGradient>
      </defs>
      <rect x="18" y="12" width="5" height="14" rx="1.5" fill="#1f6fe0" />
      <rect x="25" y="8" width="5" height="18" rx="1.5" fill="#2f86f0" />
      <rect x="32" y="14" width="5" height="12" rx="1.5" fill="#1f6fe0" />
      <rect x="6" y="20" width="50" height="38" rx="8" fill="url(#acct-wallet)" />
      <path d="M6 28a8 8 0 0 1 8-8h34a8 8 0 0 1 8 8z" fill="#fff" opacity="0.15" />
      <rect x="14" y="40" width="5" height="10" rx="1.5" fill="#fff" opacity="0.55" />
      <rect x="22" y="34" width="5" height="16" rx="1.5" fill="#fff" opacity="0.75" />
      <rect x="30" y="38" width="5" height="12" rx="1.5" fill="#fff" opacity="0.55" />
      <rect x="44" y="33" width="16" height="13" rx="5" fill="#1557b8" />
      <circle cx="51" cy="39.5" r="3" fill="#7cc8ff" />
      <circle cx="47" cy="13" r="10" fill="url(#acct-coin)" stroke="#fff" strokeWidth="2" />
      <path d="M50 9.5c-.8-.9-2-1.4-3.2-1.4-1.8 0-3.1 1-3.1 2.4 0 3.3 6.6 1.8 6.6 5 0 1.4-1.4 2.5-3.3 2.5-1.4 0-2.7-.6-3.5-1.6M47 6.5v2M47 18v2" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function SalesArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="sales-bag" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffab3d" />
          <stop offset="1" stopColor="#f2621f" />
        </linearGradient>
        <linearGradient id="sales-doc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe9a8" />
          <stop offset="1" stopColor="#ffc54d" />
        </linearGradient>
      </defs>
      <rect x="34" y="6" width="24" height="30" rx="3" fill="url(#sales-doc)" />
      <path d="M39 13h14M39 18h14M39 23h9" stroke="#e8a317" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M15 24v-4a8 8 0 0 1 16 0v4" fill="none" stroke="#e8571a" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M6 24h34l-2.6 31a4 4 0 0 1-4 3.6H12.6a4 4 0 0 1-4-3.6z" fill="url(#sales-bag)" />
      <path d="M10 49l9-9 6 5 13-13" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M31 31h8v8" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SuppliersArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="sup-doc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e9b3f2" />
          <stop offset="1" stopColor="#c47ae0" />
        </linearGradient>
        <linearGradient id="sup-check" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b47cf5" />
          <stop offset="1" stopColor="#7c4ddb" />
        </linearGradient>
      </defs>
      <path d="M18 6h20l8 8v26H18z" fill="url(#sup-doc)" />
      <path d="M38 6v8h8" fill="#f3d7f9" />
      <path d="M23 18h14M23 23h17M23 28h11" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity="0.85" />
      <path d="M6 26h6l5 20h24" fill="none" stroke="#9d5cc9" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 32h31l-3 12H16z" fill="#b06fd6" opacity="0.9" />
      <circle cx="20" cy="53" r="3.6" fill="#7c4ddb" />
      <circle cx="37" cy="53" r="3.6" fill="#7c4ddb" />
      <circle cx="49" cy="46" r="10" fill="url(#sup-check)" stroke="#fff" strokeWidth="2" />
      <path d="M44.5 46.5l3.2 3.2 6-6.4" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
