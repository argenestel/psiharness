interface WorkerGlobalScope {
	loadPyodide(options: { indexURL: string }): Promise<any>;
}
