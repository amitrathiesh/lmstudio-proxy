const vscode = require('vscode');
const { ProxyManager } = require('./proxy-manager');

let proxyManager;
let statusBarItem;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('LMStudio Proxy Extension is now active!');

    // Initialize output channel
    const outputChannel = vscode.window.createOutputChannel('LMStudio Proxy');

    // Initialize proxy manager
    proxyManager = new ProxyManager(outputChannel);

    // Initialize Status Bar Item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'lmstudioProxy.showLogs';
    context.subscriptions.push(statusBarItem);

    updateStatusBar(false);

    // Register Commands
    let startCmd = vscode.commands.registerCommand('lmstudioProxy.start', () => {
        const config = vscode.workspace.getConfiguration('lmstudioProxy');
        const port = config.get('port') || 1235;
        const targetUrl = config.get('targetUrl') || 'http://localhost:1234';
        const debug = config.get('debug') || false;

        proxyManager.start(port, targetUrl, debug)
            .then(() => {
                vscode.window.showInformationMessage(`LMStudio Proxy started on port ${port}`);
                updateStatusBar(true);
            })
            .catch(err => {
                vscode.window.showErrorMessage(`Failed to start proxy: ${err.message}`);
                updateStatusBar(false);
            });
    });

    let stopCmd = vscode.commands.registerCommand('lmstudioProxy.stop', () => {
        proxyManager.stop();
        vscode.window.showInformationMessage('LMStudio Proxy stopped');
        updateStatusBar(false);
    });

    let restartCmd = vscode.commands.registerCommand('lmstudioProxy.restart', () => {
        vscode.commands.executeCommand('lmstudioProxy.stop');
        setTimeout(() => {
            vscode.commands.executeCommand('lmstudioProxy.start');
        }, 1000);
    });

    let showLogsCmd = vscode.commands.registerCommand('lmstudioProxy.showLogs', () => {
        outputChannel.show();
    });

    context.subscriptions.push(startCmd, stopCmd, restartCmd, showLogsCmd);

    // Auto-Start Check
    const config = vscode.workspace.getConfiguration('lmstudioProxy');
    if (config.get('autoStart')) {
        vscode.commands.executeCommand('lmstudioProxy.start');
    }
}

function deactivate() {
    if (proxyManager) {
        proxyManager.stop();
    }
}

function updateStatusBar(isRunning) {
    if (isRunning) {
        statusBarItem.text = '$(radio-tower) Proxy: ON';
        statusBarItem.tooltip = 'LMStudio Proxy is running nicely';
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = '$(circle-slash) Proxy: OFF';
        statusBarItem.tooltip = 'LMStudio Proxy is stopped';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
    statusBarItem.show();
}

module.exports = {
    activate,
    deactivate
};
