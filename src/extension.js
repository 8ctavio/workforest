import * as vscode from 'vscode'
import * as wsc from './workspace/commands.js'
import * as wtc from './worktree/commands.js'
import { workspaceProvider } from './workspace/WorkspaceProvider.js'
import { worktreeProvider } from './worktree/WorktreeProvider.js'

/**
 * @param { vscode.ExtensionContext } context 
 */
export function activate(context) {
	const { commands } = vscode
	const { subscriptions } = context

	for (const command of /** @type {(keyof typeof wsc)[]} */(Object.keys(wsc))) {
		subscriptions.push(commands.registerCommand(`workforest.${command}`, wsc[command]))
	}
	for (const command of /** @type {(keyof typeof wtc)[]} */(Object.keys(wtc))) {
		subscriptions.push(commands.registerCommand(`workforest.${command}`, wtc[command]))
	}

	subscriptions.push(
		vscode.window.registerTreeDataProvider('workspaces', workspaceProvider),
		vscode.window.registerTreeDataProvider('worktrees', worktreeProvider),
		worktreeProvider
	)
}