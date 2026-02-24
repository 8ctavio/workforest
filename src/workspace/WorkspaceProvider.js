import * as vscode from 'vscode'
import { readdir } from 'node:fs/promises'
import { join, extname } from 'node:path'

export class WorkspaceItem extends vscode.TreeItem {
	/** @param { string } workspacePath */
	constructor(workspacePath) {
		super(vscode.Uri.file(workspacePath))
		this.tooltip = 'Open Workspace'
		this.command = {
			title: "Open Workspace",
			command: 'vscode.openFolder',
			arguments: [this.resourceUri]
		}
	}
}

/**
 * @implements { vscode.TreeDataProvider<WorkspaceItem> }
 */
class WorkspaceProvider {
	/** @type { vscode.EventEmitter<WorkspaceItem | undefined | null | void> } */
	#changeTreeDataEmitter = new vscode.EventEmitter()

	onDidChangeTreeData = this.#changeTreeDataEmitter.event

	refresh() {
		this.#changeTreeDataEmitter.fire()
	}

	/** @param { WorkspaceItem } element */
	getTreeItem(element) {
		return element
	}

	/** @param { WorkspaceItem } [element] */
	async getChildren(element) {
		if (element) return

		/** @type { string | undefined } */
		const workspaceDir = vscode.workspace.getConfiguration('workforest').get('workspaceDirectory')
		if (!workspaceDir) return
		
		try {
			const files = await readdir(workspaceDir)
			/** @type { WorkspaceItem[] } */
			const items = []
			for (const file of files) {
				if (extname(file) === '.code-workspace') {
					items.push(new WorkspaceItem(join(workspaceDir, file)))
				}
			}
			return items
		} catch(error) {
			console.error(error)
		}
	}
}

export const workspaceProvider = new WorkspaceProvider()