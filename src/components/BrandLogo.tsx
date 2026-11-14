import { useId } from 'react';

export type BrandLogoVariant =
  | 'mark'
  | 'horizontal-light'
  | 'horizontal-dark'
  | 'horizontal-auto'
  | 'stacked'
  | 'mono';

interface BrandLogoProps {
  variant?: BrandLogoVariant;
  className?: string;
  decorative?: boolean;
}

export function BrandLogo({
  variant = 'mark',
  className = '',
  decorative = false,
}: BrandLogoProps) {
  const uid = useId().replace(/:/g, '_');

  if (variant === 'mark') {
    const front = `${uid}_mf`;
    const mid = `${uid}_mm`;
    const back = `${uid}_mb`;
    const fold = `${uid}_mfld`;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 128 128"
        fill="none"
        className={className}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : 'gullacpdf'}
        role={decorative ? undefined : 'img'}
      >
        <defs>
          <linearGradient id={front} x1="24" y1="20" x2="104" y2="112" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#3B82F6" />
            <stop offset="55%" stopColor="#2563EB" />
            <stop offset="100%" stopColor="#1D4ED8" />
          </linearGradient>
          <linearGradient id={mid} x1="20" y1="32" x2="108" y2="96" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#0284C7" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id={back} x1="30" y1="16" x2="98" y2="88" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id={fold} x1="76" y1="16" x2="100" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#BAE6FD" />
            <stop offset="100%" stopColor="#60A5FA" />
          </linearGradient>
        </defs>
        <rect x="34" y="12" width="66" height="84" rx="14" transform="rotate(6 67 54)" fill={`url(#${back})`} />
        <rect x="22" y="22" width="68" height="86" rx="14" transform="rotate(-5 56 65)" fill={`url(#${mid})`} />
        <path
          d="M38 22H76L98 44V98C98 105.732 91.732 112 84 112H38C30.268 112 24 105.732 24 98V36C24 28.268 30.268 22 38 22Z"
          fill={`url(#${front})`}
        />
        <path d="M76 22V36C76 40.4183 79.5817 44 84 44H98L76 22Z" fill={`url(#${fold})`} />
        <path
          d="M66 56H54C47.3726 56 42 61.3726 42 68V76C42 82.6274 47.3726 88 54 88H68C73.5228 88 78 83.5228 78 78V72H61"
          stroke="#FFFFFF"
          strokeWidth="6.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="78" cy="60" r="4" fill="#38BDF8" />
      </svg>
    );
  }

  if (variant === 'mono') {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 64"
        fill="none"
        className={className}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : 'gullacpdf'}
        role={decorative ? undefined : 'img'}
      >
        <path
          d="M18 11H41L52 22V49C52 52.866 48.866 56 45 56H18C14.134 56 11 52.866 11 49V18C11 14.134 14.134 11 18 11Z"
          fill="#2563EB"
        />
        <path d="M41 11V18C41 20.2091 42.7909 22 45 22H52L41 11Z" fill="#93C5FD" />
        <path
          d="M35 28H28C24.6863 28 22 30.6863 22 34V39C22 42.3137 24.6863 45 28 45H36C38.7614 45 41 42.7614 41 40V36.5H32"
          stroke="#FFFFFF"
          strokeWidth="3.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (variant === 'stacked') {
    const front = `${uid}_sf`;
    const mid = `${uid}_sm`;
    const back = `${uid}_sb`;
    const fold = `${uid}_sfld`;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 340 230"
        fill="none"
        className={className}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : 'gullacpdf'}
        role={decorative ? undefined : 'img'}
      >
        <defs>
          <linearGradient id={front} x1="94" y1="24" x2="184" y2="128" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#3B82F6" />
            <stop offset="55%" stopColor="#2563EB" />
            <stop offset="100%" stopColor="#1D4ED8" />
          </linearGradient>
          <linearGradient id={mid} x1="88" y1="36" x2="188" y2="112" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#0284C7" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id={back} x1="100" y1="20" x2="178" y2="104" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id={fold} x1="152" y1="20" x2="178" y2="46" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#BAE6FD" />
            <stop offset="100%" stopColor="#60A5FA" />
          </linearGradient>
        </defs>
        <g transform="translate(106, 12)">
          <rect x="34" y="12" width="66" height="84" rx="14" transform="rotate(6 67 54)" fill={`url(#${back})`} />
          <rect x="22" y="22" width="68" height="86" rx="14" transform="rotate(-5 56 65)" fill={`url(#${mid})`} />
          <path
            d="M38 22H76L98 44V98C98 105.732 91.732 112 84 112H38C30.268 112 24 105.732 24 98V36C24 28.268 30.268 22 38 22Z"
            fill={`url(#${front})`}
          />
          <path d="M76 22V36C76 40.4183 79.5817 44 84 44H98L76 22Z" fill={`url(#${fold})`} />
          <path
            d="M66 56H54C47.3726 56 42 61.3726 42 68V76C42 82.6274 47.3726 88 54 88H68C73.5228 88 78 83.5228 78 78V72H61"
            stroke="#FFFFFF"
            strokeWidth="6.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="78" cy="60" r="4" fill="#38BDF8" />
        </g>
        <g transform="translate(-96, 118)">
          <g
            strokeWidth="6.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            className="stroke-slate-900 dark:stroke-slate-50"
          >
            <circle cx="134" cy="56" r="13" />
            <path d="M147 43V69C147 77.5 141 83 132.5 83C126.5 83 122.5 80.5 120.5 77" />
            <path d="M161 43V58C161 64.6274 166.373 70 173 70C179.627 70 185 64.6274 185 58V43" />
            <path d="M199 30V63C199 67.5 201.5 70 205.5 70" />
            <path d="M217 30V63C217 67.5 219.5 70 223.5 70" />
            <circle cx="247" cy="56.5" r="13.5" />
            <path d="M260.5 43V70" />
            <path d="M297 47.5C294.5 44.5 290.8 43 286.5 43C279.044 43 273 49.0442 273 56.5C273 63.9558 279.044 70 286.5 70C290.8 70 294.5 68.5 297 65.5" />
          </g>
          <g
            strokeWidth="4.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            className="stroke-blue-600 dark:stroke-sky-400"
          >
            <path d="M316 43V82" />
            <circle cx="329" cy="56.5" r="13" />
            <path d="M378 30V70" />
            <circle cx="365" cy="56.5" r="13" />
            <path d="M405 33C401 30.5 395 31.5 395 38.5V70" />
            <path d="M389 46H404" />
          </g>
          <circle cx="412" cy="68" r="3.2" fill="#38BDF8" />
        </g>
      </svg>
    );
  }

  // horizontal-light | horizontal-dark | horizontal-auto
  const isLight = variant === 'horizontal-light';
  const isDark = variant === 'horizontal-dark';
  const front = `${uid}_hf`;
  const mid = `${uid}_hm`;
  const back = `${uid}_hb`;
  const fold = `${uid}_hfld`;
  const accent = `${uid}_hacc`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 430 112"
      fill="none"
      className={className}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : 'gullacpdf'}
      role={decorative ? undefined : 'img'}
    >
      <defs>
        <linearGradient id={front} x1="20" y1="16" x2="88" y2="96" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={isDark ? '#60A5FA' : '#3B82F6'} />
          <stop offset="55%" stopColor={isDark ? '#3B82F6' : '#2563EB'} />
          <stop offset="100%" stopColor="#1D4ED8" />
        </linearGradient>
        <linearGradient id={mid} x1="16" y1="26" x2="92" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8" stopOpacity={isDark ? '0.7' : '0.85'} />
          <stop offset="100%" stopColor="#0284C7" stopOpacity={isDark ? '0.8' : '0.9'} />
        </linearGradient>
        <linearGradient id={back} x1="24" y1="12" x2="84" y2="76" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#93C5FD" stopOpacity={isDark ? '0.3' : '0.5'} />
          <stop offset="100%" stopColor="#3B82F6" stopOpacity={isDark ? '0.2' : '0.35'} />
        </linearGradient>
        <linearGradient id={fold} x1="64" y1="12" x2="86" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={isDark ? '#E0F2FE' : '#BAE6FD'} />
          <stop offset="100%" stopColor={isDark ? '#7DD3FC' : '#60A5FA'} />
        </linearGradient>
        <linearGradient id={accent} x1="315" y1="30" x2="415" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>
      </defs>

      <g transform="translate(8, 4)">
        <rect x="28" y="8" width="56" height="72" rx="12" transform="rotate(6 56 44)" fill={`url(#${back})`} />
        <rect x="18" y="16" width="58" height="74" rx="12" transform="rotate(-5 47 53)" fill={`url(#${mid})`} />
        <path
          d="M32 16H64L83 35V82C83 88.6274 77.6274 94 71 94H32C25.3726 94 20 88.6274 20 82V28C20 21.3726 25.3726 16 32 16Z"
          fill={`url(#${front})`}
        />
        <path d="M64 16V28C64 31.866 67.134 35 71 35H83L64 16Z" fill={`url(#${fold})`} />
        <path
          d="M56 45H46C40.4772 45 36 49.4772 36 55V62C36 67.5228 40.4772 72 46 72H58C62.4183 72 66 68.4183 66 64V59H52"
          stroke="#FFFFFF"
          strokeWidth="5.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="66" cy="49" r="3.5" fill={isDark ? '#7DD3FC' : '#38BDF8'} />
      </g>

      <g
        stroke={isLight ? '#0F172A' : isDark ? '#F8FAFC' : undefined}
        className={variant === 'horizontal-auto' ? 'stroke-slate-900 dark:stroke-slate-50' : undefined}
        strokeWidth="6.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <circle cx="134" cy="56" r="13" />
        <path d="M147 43V69C147 77.5 141 83 132.5 83C126.5 83 122.5 80.5 120.5 77" />
        <path d="M161 43V58C161 64.6274 166.373 70 173 70C179.627 70 185 64.6274 185 58V43" />
        <path d="M199 30V63C199 67.5 201.5 70 205.5 70" />
        <path d="M217 30V63C217 67.5 219.5 70 223.5 70" />
        <circle cx="247" cy="56.5" r="13.5" />
        <path d="M260.5 43V70" />
        <path d="M297 47.5C294.5 44.5 290.8 43 286.5 43C279.044 43 273 49.0442 273 56.5C273 63.9558 279.044 70 286.5 70C290.8 70 294.5 68.5 297 65.5" />
      </g>

      <g
        stroke={isLight ? `url(#${accent})` : isDark ? '#38BDF8' : undefined}
        className={variant === 'horizontal-auto' ? 'stroke-blue-600 dark:stroke-sky-400' : undefined}
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M316 43V82" />
        <circle cx="329" cy="56.5" r="13" />
        <path d="M378 30V70" />
        <circle cx="365" cy="56.5" r="13" />
        <path d="M405 33C401 30.5 395 31.5 395 38.5V70" />
        <path d="M389 46H404" />
      </g>

      <circle cx="412" cy="68" r="3.2" fill={isDark ? '#7DD3FC' : '#38BDF8'} />
    </svg>
  );
}
