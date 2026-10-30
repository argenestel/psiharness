const codes = { green: 32, red: 31, yellow: 33, cyan: 36 };

/** Color terminal output only when stdout is a TTY and NO_COLOR is unset. */
export function color(text: string, name: keyof typeof codes): string {
	return process.stdout.isTTY && process.env.NO_COLOR === undefined ? `\x1b[${codes[name]}m${text}\x1b[0m` : text;
}

/** Render a plain, aligned table. */
export function table(headers: string[], rows: string[][]): string {
	const clean = (value: string) => value.replace(/[\r\n\t]/g, " ");
	const cells = [headers, ...rows].map((row) => row.map(clean));
	const widths = headers.map((_, i) => Math.max(...cells.map((row) => [...(row[i] ?? "")].length)));
	return cells.map((row) => row.map((cell, i) => cell + " ".repeat(widths[i] - [...cell].length))
		.join("  ").trimEnd()).join("\n");
}
