/** Optional API installed by the pinned KaTeX CDN script. */
interface Window {
	katex?: {
		render(text: string, element: HTMLElement, options: {
			displayMode: boolean;
			throwOnError: boolean;
			trust: boolean;
			strict: string;
			maxExpand: number;
		}): void;
	};
}
