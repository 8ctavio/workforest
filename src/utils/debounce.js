/**
 * @template { Function } [T = (this: unknown, ...args: unknown[]) => void]
 * @typedef { T & { dispose: () => void }} Debounced
 */

/**
 * Creates a debounced function.
 * 
 * @template { Function } T
 * @overload
 * @param { T } fn Function to debounce. 
 * @param { number } minWait
 *   Time in milliseconds to wait before executing `fn` since the debounced function's last call.
 * @param { object } [options]
 * @param { boolean } [options.eager]
 *   When set to `true`, `fn` is executed as soon as the debounced function is called
 *   *if* `fn` is not scheduled and `minWait` milliseconds have elapsed since `fn`'s
 *   last execution (or `fn` has not been executed). Defaults to `false`.
 * 
 * @returns { Debounced<T> } Debounced function with `dispose` method to cancel scheduled `fn` execution.
 * 
 * @param { Function } fn
 * @param { number } minWait
 * @param {{
 *   eager?: boolean
 * }} [options]
 */
export function debounce(fn, minWait, options = {}) {
	const { eager = false } = options

	/** @type { Debounced } } */
	let debounced
	/** @type { ReturnType<typeof setTimeout> | undefined } */
	let delay
	if (eager) {
		/** @type { ReturnType<typeof setTimeout> | undefined } */
		let cooldown
		/** @type { (thisArg: unknown, args: unknown[]) => void } */
		const task = (thisArg, args) => {
			fn.apply(thisArg, args)
			clearTimeout(cooldown)
			cooldown = setTimeout(() => cooldown = undefined, minWait)
			delay = undefined
		}
		debounced = /** @type { Debounced } } */ (function(...args) {
			if (delay || cooldown) {
				clearTimeout(delay)
				delay = setTimeout(task, minWait, this, args)
			} else {
				task(this, args)
			}
		})
	} else {
		/** @type { (thisArg: unknown, args: unknown[]) => void } */
		const task = (thisArg, args) => fn.apply(thisArg, args)
		debounced = /** @type { Debounced } } */ (function(...args) {
			clearTimeout(delay)
			delay = setTimeout(task, minWait, this, args)
		})
	}
	debounced.dispose = () => delay = void clearTimeout(delay)
	return debounced
}