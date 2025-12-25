const cp = require('child_process');
const path = require('path');

class ProxyManager {
    constructor(outputChannel) {
        this.outputChannel = outputChannel;
        this.childProcess = null;
    }

    start(port, targetUrl, debug) {
        return new Promise((resolve, reject) => {
            if (this.childProcess) {
                this.outputChannel.appendLine('Proxy is already running.');
                resolve();
                return;
            }

            const proxyScriptPath = path.join(__dirname, 'proxy.mjs');

            this.outputChannel.appendLine(`Starting proxy on port ${port} -> ${targetUrl} (Debug: ${debug})`);

            // Spawn the proxy as a child process using the system's Node.js
            // formatting environment variables for the child process
            const env = {
                ...process.env,
                PROXY_PORT: port.toString(),
                LMSTUDIO_URL: targetUrl,
                DEBUG: debug.toString()
            };

            this.childProcess = cp.spawn('node', [proxyScriptPath], {
                env: env,
                shell: true
            });

            this.childProcess.stdout.on('data', (data) => {
                const msg = data.toString();
                this.outputChannel.append(msg);

                // Check for success message to resolve the promise
                if (msg.includes('Proxy server running on:')) {
                    resolve();
                }
            });

            this.childProcess.stderr.on('data', (data) => {
                this.outputChannel.append(`ERROR: ${data.toString()}`);
            });

            this.childProcess.on('error', (err) => {
                this.outputChannel.appendLine(`Failed to start subprocess: ${err}`);
                this.childProcess = null;
                reject(err);
            });

            this.childProcess.on('close', (code) => {
                this.outputChannel.appendLine(`Proxy process exited with code ${code}`);
                this.childProcess = null;
            });
        });
    }

    stop() {
        if (this.childProcess) {
            this.outputChannel.appendLine('Stopping proxy server...');
            // Need to kill the whole process tree if shell: true was used
            // process.kill(-this.childProcess.pid) works on unix for process groups, 
            // but simple kill usually works for simple node scripts
            this.childProcess.kill();
            this.childProcess = null;
        } else {
            this.outputChannel.appendLine('Proxy is not running.');
        }
    }
}

module.exports = { ProxyManager };
