import * as vscode from 'vscode'
import { parse, join, basename, dirname } from 'node:path'
import { existsSync } from 'node:fs'

/**
 * Map<pathRoot, isCaseInsensitive>
 * @type { Map<string, boolean> }
 */
const rootCaseSensitivity = new Map()

/** @param { string | vscode.Uri } path */
export function tryNormalizePath(path) {
	const uri = typeof path === 'string' ? vscode.Uri.file(path) : path
	path = uri.fsPath.normalize('NFC')

	const { root } = parse(path)
	const isCaseInsensitive = rootCaseSensitivity.get(root.toUpperCase())

	return typeof isCaseInsensitive === 'boolean'
		? isCaseInsensitive ? path.toUpperCase() : path
		: null
}

/** @param { string | vscode.Uri } worktreePath */
export function normalizeWorktreePath(worktreePath) {
	const uri = typeof worktreePath === 'string'
		? vscode.Uri.file(worktreePath)
		: worktreePath
	worktreePath = uri.fsPath.normalize('NFC')
	
	const root = parse(worktreePath).root.toUpperCase()
	let isCaseInsensitive = rootCaseSensitivity.get(root)
	if (typeof isCaseInsensitive !== 'boolean') {
		if (existsSync(join(worktreePath, '.git'))) {
			isCaseInsensitive =
				existsSync(join(worktreePath, '.GiT')) &&
				existsSync(join(worktreePath, '.gIt'))
		} else if (existsSync(join(worktreePath, 'HEAD'))) {
			isCaseInsensitive =
				existsSync(join(worktreePath, 'hEAd')) &&
				existsSync(join(worktreePath, 'hEaD'))
		} else {
			isCaseInsensitive = existsSync(join(
				dirname(worktreePath),
				invertCase(basename(worktreePath))
			))
		}
		rootCaseSensitivity.set(root, isCaseInsensitive)
	}

	return isCaseInsensitive
		? worktreePath.toUpperCase()
		: worktreePath
}

/**
 * @param { string } path
 * @param { number } [maxLength]
 */
export function clipPath(path, maxLength = 25) {
	return clip(path, maxLength, {
		location: 'start',
		guideline: /[/\\]/g
	})
}

/** @param { string } str */
function invertCase(str) {
	let inverted = ''
	for (const char of str) {
		const upper = char.toUpperCase()
		inverted += char === upper ? char.toLowerCase() : upper
	}
	return inverted
}

/**
 * @param { string } str
 * @param { number } maxLength
 * @param { object } [options]
 * @param { 'start' | 'middle' | 'end' } [options.location]
 * @param { string } [options.offcut]
 * @param { string | RegExp } [options.guideline]
 */
function clip(str, maxLength, options = {}) {
	if (str.length < maxLength) return str

	const {
		location = 'end',
		offcut = '...',
		guideline
	} = options

	const netLength = maxLength - offcut.length
	if (netLength <= 0) return offcut.slice(0, netLength)
	
	let leadingEnd = 0, trailingStart = str.length
	
	if (location === 'end') {
		leadingEnd = netLength
	} else if (location === 'start') {
		trailingStart -= netLength
	} else {
		const trailingLength = Math.trunc(netLength / 2)
		leadingEnd = netLength - trailingLength
		trailingStart -= trailingLength
	}

	if (guideline) {
		if (typeof guideline === 'string') {
			/** @type { number } */
			let idx
			idx = str.lastIndexOf(guideline, leadingEnd - guideline.length)
			if (idx > -1) {
				leadingEnd = idx + guideline.length
			}

			idx = str.indexOf(guideline, trailingStart)
			if (idx > -1) {
				trailingStart = idx
			}
		} else {
			const regex = new RegExp(guideline, (guideline.global ? '' : 'g') + guideline.flags)
			const substr = str.slice(0, leadingEnd)
			while (regex.exec(substr)) {
				leadingEnd = regex.lastIndex
			}

			regex.lastIndex = trailingStart
			const match = regex.exec(str)
			if (match) {
				trailingStart = match.index
			}
		}
	}

	return str.slice(0, leadingEnd) + offcut + str.slice(trailingStart)
}