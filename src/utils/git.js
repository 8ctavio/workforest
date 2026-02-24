import { spawn } from "node:child_process"
import * as vscode from 'vscode'

/**
 * @import { GitExtension } from '../dts/git.d.ts'
 */

/** @type { string } */
let gitCommand

/**
 * @see https://github.com/microsoft/vscode/blob/main/extensions/git/README.md
 */
export function useGit() {
	const gitExtension = /** @type { vscode.Extension<GitExtension> } */
		(vscode.extensions.getExtension('vscode.git'))
	return gitExtension.exports.getAPI(1)
}

/**
 * @param { string } cwd
 * @param { readonly string[] } args 
 */
export function runGit(cwd, args) {
	return new Promise((resolve, reject) => {
		gitCommand ??= process.platform === 'win32' ? useGit().git.path : 'git'
		const git = spawn(gitCommand, args, {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe']
		})

		/** @type { Buffer[] } */
		const stdoutChunks = []
		/** @type { Buffer[] } */
		const stderrChunks = []

		git.stdout.on('data', chunk => {
			stdoutChunks.push(chunk)
		})
		git.stderr.on('data', chunk => {
			stderrChunks.push(chunk)
		})

		git.on('error', error => {
			reject(error)
		})

		git.on('exit', code => {
			const stdout = Buffer.concat(stdoutChunks).toString()
			const stderr = Buffer.concat(stderrChunks).toString()
			if (code === 0) {
				resolve({ stdout, stderr })
			} else {
				reject(`Failed to execute command: \`git ${args.join(' ')}\`. ${stderr}`)
			}
		})
	})
}

/**
 * @typedef { object } Worktree
 * @property { string } path
 * @property { string } [HEAD]
 * @property { string } [branch]
 * @property { boolean } [bare]
 * @property { boolean } [detached]
 * @property { string | true } [locked]
 * @property { string | true} [prunable]
 */

/** @param { string } path */
export async function getWorktrees(path) {
	const { stdout } = await runGit(path, ['worktree', 'list', '--porcelain', '-z'])

	let idx = 0
	/** @type { Record<string, unknown> } */
	let worktree = {}
	/** @type { [Worktree, ...Worktree[]] } */
	const worktrees = /**@type {any}*/([])
	while (idx < stdout.length) {
		if (stdout[idx] === '\0') {
			idx++
			worktrees.push(/** @type { Worktree } */(worktree))
			worktree = {}
			continue
		}
		
		const attrEnd = stdout.indexOf('\0', idx)
		const attr = stdout.slice(idx, attrEnd)
		const attrSep = attr.indexOf(' ')

		/** @type { string } */
		let key
		/** @type { string | true } */
		let value
		if (attrSep > -1) {
			key = attr.slice(0, attrSep)
			value = attr.slice(attrSep + 1)
		} else {
			key = attr
			value = true
		}

		if (key === 'worktree') {
			worktree.path = value
		} else if (key === 'branch' && typeof value === 'string' && value.startsWith('refs/heads/')) {
			worktree.branch = value.slice('refs/heads/'.length)
		} else {
			worktree[key] = value
		}
		
		idx = attrEnd + 1
	}
	return worktrees
}

/**
 * @param { string } path
 * @param { string } rev
 * @returns
 */
export async function isValidRef(path, rev) {
	try {
		await runGit(path, ['rev-parse', '--verify', rev])
		return true
	} catch {
		return false
	}
}