import * as vscode from "vscode"
import { spawn } from "node:child_process"
import { normalizeWorktreePath } from "./path.js"

/**
 * @import { GitExtension, API } from '../dts/git.d.ts'
 */

/** @type { API } */
let gitApi
/** @type { string } */
let gitCommand

/**
 * @see https://github.com/microsoft/vscode/blob/main/extensions/git/README.md
 */
export function useGit() {
	return gitApi ??= /** @type { vscode.Extension<GitExtension> } */
		(vscode.extensions.getExtension('vscode.git'))
		.exports
		.getAPI(1)
}

export class ExecutionError extends Error {
	/**
	 * @param { string } command
	 * @param { readonly string[] } args
	 * @param { number | null } exitCode
	 * @param { string } stdout
	 * @param { string } stderr
	 */
	constructor(command, args, exitCode, stdout, stderr) {
		super(`Failed to execute command: \`${command} ${args.join(' ')}\`. ${stderr || stdout}`)
		this.exitCode = exitCode
		this.stdout = stdout
		this.stderr = stderr
	}
}

/**
 * @typedef { object } RunGitOptions
 * @property { AbortSignal } [signal]
 */

/**
 * @param { string } cwd
 * @param { readonly string[] } args
 * @param { RunGitOptions } [options]
 * @returns { Promise<{ exitCode: number | null, stdout: string, stderr: string }> }
 */
export function runGit(cwd, args, { signal } = {}) {
	return new Promise((resolve, reject) => {
		gitCommand ??= process.platform === 'win32' ? useGit().git.path : 'git'
		const git = spawn(gitCommand, args, {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
			signal
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

		git.on('close', exitCode => {
			const stdout = Buffer.concat(stdoutChunks).toString().trim()
			const stderr = Buffer.concat(stderrChunks).toString().trim()
			if (exitCode === 0) {
				resolve({ exitCode, stdout, stderr })
			} else {
				reject(new ExecutionError('git', args, exitCode, stdout, stderr))
			}
		})
	})
}

/**
 * @template { boolean } [T = boolean]
 * @typedef { object } Worktree
 * @property { T } isMain
 * @property { string } path
 * @property { string } normalizedPath
 * @property { string } [HEAD]
 * @property { string } [branch]
 * @property { string | true } [locked]
 * @property { string | true } [prunable]
 * @property { true } [bare]
 * @property { true } [detached]
 */

/**
 * @param { string } path
 * @param { RunGitOptions } [options]
 */
export async function getWorktrees(path, options) {
	const { stdout } = await runGit(path, ['worktree', 'list', '--porcelain', '-z'], options)

	let idx = 0
	/** @type { Record<string, unknown> } */
	let worktree = { isMain: true }
	/** @type { [Worktree<true>, ...Worktree<false>[]] } */
	const worktrees = /**@type {any}*/([])
	while (idx < stdout.length) {
		if (stdout[idx] === '\0') {
			idx++
			worktrees.push(/** @type { Worktree } */(worktree))
			worktree = { isMain: false }
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
			worktree.normalizedPath = normalizeWorktreePath(/**@type {string}*/(value))
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