import type { SVGProps } from "react";

type IconName =
	| "dashboard"
	| "providers"
	| "key"
	| "login"
	| "quota"
	| "logs"
	| "config"
	| "menu"
	| "close"
	| "refresh"
	| "search"
	| "arrow"
	| "check"
	| "warning"
	| "external"
	| "copy"
	| "logout"
	| "shield"
	| "server"
	| "clock";

const paths: Record<IconName, React.ReactNode> = {
	dashboard: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="4" rx="2" /><rect x="14" y="11" width="7" height="10" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /></>,
	providers: <><circle cx="6" cy="12" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="m8.7 10.6 6.6-3.2M8.7 13.4l6.6 3.2" /></>,
	key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8 2 2-2 2 2 2-3 3-2-2-2 2" /></>,
	login: <><path d="M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" /><path d="M10 17l5-5-5-5M15 12H3" /></>,
	quota: <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" /><path d="m4 6 6-3 6 6 5-4" /></>,
	logs: <><path d="M4 5h16M4 12h16M4 19h10" /><circle cx="2" cy="5" r=".5" fill="currentColor" /><circle cx="2" cy="12" r=".5" fill="currentColor" /><circle cx="2" cy="19" r=".5" fill="currentColor" /></>,
	config: <><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.06.06-2.78 2.78-.06-.06A1.8 1.8 0 0 0 15 19.4a1.8 1.8 0 0 0-1.1 1.64V21H10v-.08A1.8 1.8 0 0 0 8.9 19.3a1.8 1.8 0 0 0-1.98.36l-.06.06-2.78-2.78.06-.06A1.8 1.8 0 0 0 4.5 15a1.8 1.8 0 0 0-1.64-1.1H2V10h.86A1.8 1.8 0 0 0 4.5 8.9a1.8 1.8 0 0 0-.36-1.98l-.06-.06 2.78-2.78.06.06A1.8 1.8 0 0 0 8.9 4.5 1.8 1.8 0 0 0 10 2.86V2h4v.86a1.8 1.8 0 0 0 1.1 1.64 1.8 1.8 0 0 0 1.98-.36l.06-.06 2.78 2.78-.06.06a1.8 1.8 0 0 0-.36 1.98A1.8 1.8 0 0 0 21.14 10H22v4h-.86A1.8 1.8 0 0 0 19.4 15Z" /></>,
	menu: <path d="M4 7h16M4 12h16M4 17h16" />,
	close: <path d="m6 6 12 12M18 6 6 18" />,
	refresh: <><path d="M20 11a8 8 0 1 0-2.34 5.66" /><path d="M20 4v7h-7" /></>,
	search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
	arrow: <path d="m9 18 6-6-6-6" />,
	check: <path d="m5 12 4 4L19 6" />,
	warning: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v4M12 17h.01" /></>,
	external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></>,
	copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
	logout: <><path d="M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5M14 16l4-4-4-4M18 12H8" /></>,
	shield: <><path d="M12 3 4.5 6v5.5c0 4.6 3.2 7.8 7.5 9.5 4.3-1.7 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
	server: <><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" /></>,
	clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
};

export function Icon({
	name,
	...props
}: SVGProps<SVGSVGElement> & { name: IconName }) {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="20"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.8"
			viewBox="0 0 24 24"
			width="20"
			{...props}
		>
			{paths[name]}
		</svg>
	);
}
