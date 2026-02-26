/**
 * @import { DisposableCollection } from './dispose.types.js' 
 */

/** @param { DisposableCollection } disposableCollection */
export function clearDisposables(disposableCollection) {
	const iterables = [disposableCollection]
	for (let i=0; i<iterables.length; i++) {
		const disposables = iterables[i]
		const isArray = Array.isArray(disposables)
		const isMap = !isArray && disposables instanceof Map
		const iterable = /** @type { Iterable<any> } */
			(isMap ? disposables.values() : disposables)

		for (const disposable of iterable) {
			if (disposable) {
				if (typeof disposable.dispose === 'function') {
					disposable.dispose()
				} else if (typeof disposable[Symbol.iterator] === 'function') {
					iterables.push(disposable)
				}
			}
		}
		
		if (isArray) {
			disposables.length = 0
		} else if (isMap || disposables instanceof Set) {
			disposables.clear()
		}
	}
}