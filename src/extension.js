import * as vscode from 'vscode'
import * as wsc from './workspace/commands.js'
import * as wtc from './worktree/commands.js'
import { workspaceProvider } from './workspace/WorkspaceProvider.js'
import { worktreeProvider } from './worktree/WorktreeProvider.js'
import { useGit } from './utils/git.js'

/**
 * 
 * @param { vscode.ExtensionContext } context 
 */
export function activate(context) {
	const { subscriptions } = context
	const { commands } = vscode

	for (const command of /** @type {(keyof typeof wsc)[]} */(Object.keys(wsc))) {
		subscriptions.push(commands.registerCommand(`workforest.${command}`, wsc[command]))
	}
	for (const command of /** @type {(keyof typeof wtc)[]} */(Object.keys(wtc))) {
		subscriptions.push(commands.registerCommand(`workforest.${command}`, wtc[command]))
	}

	const git = useGit()
	const refreshWorktreeProvier = () => worktreeProvider.refresh()

	subscriptions.push(
		git.onDidOpenRepository(refreshWorktreeProvier),
		git.onDidCloseRepository(refreshWorktreeProvier),
		vscode.window.registerTreeDataProvider('worktrees', worktreeProvider),
		vscode.window.registerTreeDataProvider('workspaces', workspaceProvider)
	)
}