interface PsiCodelabModule {
	compareRows(actual: unknown[], expected: unknown[], options?: { ordered?: boolean }): boolean;
}
