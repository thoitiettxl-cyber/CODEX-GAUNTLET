import { useCallback, useEffect, useRef, useState } from "react";

import { errorMessage } from "./index";

export type QueryState<T> =
	| { phase: "loading"; data: null; error: null }
	| { phase: "ready"; data: T; error: null }
	| { phase: "error"; data: null; error: string };

export function useQuery<T>(
	key: string | null,
	load: () => Promise<T>,
): QueryState<T> & { refresh: () => void } {
	const loadRef = useRef(load);
	const [nonce, setNonce] = useState(0);
	const [state, setState] = useState<QueryState<T>>({
		phase: "loading",
		data: null,
		error: null,
	});
	loadRef.current = load;

	useEffect(() => {
		if (key === null) {
			return;
		}
		let active = true;
		setState({ phase: "loading", data: null, error: null });
		void loadRef.current().then((data) => {
			if (active) {
				setState({ phase: "ready", data, error: null });
			}
		}).catch((error) => {
			if (active) {
				setState({ phase: "error", data: null, error: errorMessage(error) });
			}
		});
		return () => {
			active = false;
		};
	}, [key, nonce]);
	const refresh = useCallback(() => setNonce((value) => value + 1), []);

	return {
		...state,
		refresh,
	};
}
