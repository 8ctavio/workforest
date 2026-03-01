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

/** @param { string } str */
function invertCase(str) {
	let inverted = ''
	for (const char of str) {
		const upper = char.toUpperCase()
		inverted += char === upper ? char.toLowerCase() : upper
	}
	return inverted
}