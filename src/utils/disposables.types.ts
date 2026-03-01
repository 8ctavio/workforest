export type DisposableLike = {
	dispose(): void
}

export type DisposableItem =
	| DisposableLike
	| Map<any, DisposableItem>
	| Iterable<DisposableItem>

export type DisposableCollection =
	| Map<any, DisposableItem>
	| Iterable<DisposableItem>