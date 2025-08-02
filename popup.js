// Account manager state
let accounts = [];
let currentTab = 'accounts';

// Initialize when popup loads
document.addEventListener('DOMContentLoaded', async () => {
    await loadAccounts();
    setupEventListeners();
    document.getElementById('tokenInput').focus();
});

// Setup all event listeners
function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Add token button
    document.getElementById('addToken').addEventListener('click', addAccount);

    // Enter key in textarea
    document.getElementById('tokenInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            addAccount();
        }
    });
}

// Switch between tabs
function switchTab(tabName) {
    currentTab = tabName;

    // Update tab buttons
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}-tab`);
    });

    // Focus token input when switching to add tab
    if (tabName === 'add') {
        setTimeout(() => document.getElementById('tokenInput').focus(), 100);
    }
}

// Load accounts from storage
async function loadAccounts() {
    try {
        const result = await browser.storage.local.get(['fansly_accounts']);
        accounts = result.fansly_accounts || [];
        renderAccounts();
    } catch (error) {
        console.error('Failed to load accounts:', error);
        accounts = [];
        renderAccounts();
    }
}

// Save accounts to storage
async function saveAccounts() {
    try {
        await browser.storage.local.set({ fansly_accounts: accounts });
    } catch (error) {
        console.error('Failed to save accounts:', error);
        throw new Error('Failed to save accounts to storage');
    }
}

// Render accounts list
function renderAccounts() {
    const container = document.getElementById('accounts-list');
    const emptyState = document.getElementById('empty-state');

    if (accounts.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    const accountsHtml = accounts.map((account, index) => `
        <div class="account-item" data-index="${index}">
            <div class="account-actions">
                <button class="action-btn login-btn" title="Login with this account" data-action="login" data-index="${index}">
                    LOGIN
                </button>
                <button class="action-btn delete-btn" title="Delete account" data-action="delete" data-index="${index}">
                    DEL
                </button>
            </div>
            <div class="account-info">
                <div class="account-username">${escapeHtml(account.username)}</div>
            </div>
            ${account.displayName ? `<div class="account-display">${escapeHtml(account.displayName)}</div>` : ''}
            <div class="account-id">ID: ${account.accountId}</div>
        </div>
    `).join('');

    container.innerHTML = accountsHtml + '<div id="empty-state" class="empty-state" style="display: none;"><div class="empty-state-icon">[No Accounts]</div><div class="empty-state-text">No accounts saved</div><div class="empty-state-subtext">Add an account to get started</div></div>';

    // Add event listeners for action buttons
    container.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', handleActionClick);
    });
}

// Add new account
async function addAccount() {
    const token = document.getElementById('tokenInput').value.trim();
    const addButton = document.getElementById('addToken');

    if (!token) {
        showStatus('add', "Please enter a token", "error");
        return;
    }

    // Check if token already exists
    if (accounts.some(account => account.token === token)) {
        showStatus('add', "This token is already saved", "error");
        return;
    }

    // Disable button and show loading
    addButton.disabled = true;
    addButton.textContent = 'Verifying Token...';
    showStatus('add', "Verifying token with Fansly API...", "loading");

    try {
        // Fetch account info from Fansly API
        const response = await fetch('https://apiv3.fansly.com/api/v1/account/me', {
            method: 'GET',
            headers: {
                'Authorization': token,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.success || !data.response?.account) {
            throw new Error('Invalid API response or token');
        }

        const accountData = data.response.account;

        // Check if account already exists (by ID)
        if (accounts.some(account => account.accountId === accountData.id)) {
            throw new Error('An account with this ID is already saved');
        }

        // Create account object
        const newAccount = {
            accountId: accountData.id,
            username: accountData.username,
            displayName: accountData.displayName || null,
            email: accountData.email || null,
            token: token,
            addedAt: Date.now()
        };

        // Add to accounts and save
        accounts.push(newAccount);
        await saveAccounts();

        // Update UI
        renderAccounts();
        showStatus('add', `Account "${newAccount.username}" added successfully!`, "success");

        // Clear input
        document.getElementById('tokenInput').value = '';

        // Switch to accounts tab after successful add
        setTimeout(() => {
            switchTab('accounts');
        }, 1500);

    } catch (error) {
        console.error('Failed to add account:', error);
        showStatus('add', `Failed to add account: ${error.message}`, "error");
    } finally {
        // Reset button
        addButton.disabled = false;
        addButton.textContent = 'Add Account';
    }
}

// Login with specific account
async function loginWithAccount(index) {
    const account = accounts[index];
    if (!account) return;

    showStatus('accounts', `Logging in as ${account.username}...`, "loading");

    try {
        // Get active tab
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]?.id) {
            throw new Error("No active tab found");
        }

        // Check if we're on fansly.com
        const currentUrl = tabs[0].url;
        if (!currentUrl.includes('fansly.com')) {
            throw new Error("Please navigate to fansly.com first");
        }

        // Execute script to set token in localStorage
        const results = await browser.tabs.executeScript(tabs[0].id, {
            code: `
                (function(token, accountId) {
                    try {
                        // Create session data structure
                        const sessionData = {
                            id: "",
                            accountId: accountId,
                            deviceId: null,
                            token: token,
                            metadata: null
                        };

                        // Save to localStorage
                        localStorage.setItem('session_active_session', JSON.stringify(sessionData));

                        return { success: true, message: "Token set successfully!" };
                    } catch (error) {
                        return { success: false, message: "Failed to set token: " + error.message };
                    }
                })("${account.token.replace(/"/g, '\\"').replace(/\\/g, '\\\\')}", "${account.accountId}")
            `
        });

        if (results && results[0] && results[0].success) {
            showStatus('accounts', `Logged in as ${account.username}! Refreshing page...`, "success");

            // Refresh the page
            setTimeout(async () => {
                try {
                    await browser.tabs.reload(tabs[0].id);
                    showStatus('accounts', "Page refreshed! You should now be logged in.", "success");

                    // Close popup after successful login
                    setTimeout(() => {
                        window.close();
                    }, 1500);
                } catch (error) {
                    showStatus('accounts', `Refresh failed: ${error.message}`, "error");
                }
            }, 1000);
        } else {
            const errorMsg = results?.[0]?.message || "Unknown error occurred";
            throw new Error(errorMsg);
        }

    } catch (error) {
        console.error('Login failed:', error);
        showStatus('accounts', `Login failed: ${error.message}`, "error");
    }
}

// Handle action button clicks
function handleActionClick(event) {
    event.stopPropagation();
    const action = event.target.dataset.action;
    const index = parseInt(event.target.dataset.index);

    if (action === 'login') {
        loginWithAccount(index);
    } else if (action === 'delete') {
        deleteAccount(index);
    }
}
async function deleteAccount(index) {
    const account = accounts[index];
    if (!account) return;

    if (!confirm(`Are you sure you want to delete the account "${account.username}"?`)) {
        return;
    }

    try {
        accounts.splice(index, 1);
        await saveAccounts();
        renderAccounts();
        showStatus('accounts', `Account "${account.username}" deleted`, "success");
    } catch (error) {
        console.error('Failed to delete account:', error);
        showStatus('accounts', `Failed to delete account: ${error.message}`, "error");
    }
}

// Show status message
function showStatus(tab, message, type) {
    const statusEl = document.getElementById(`${tab}-status`);
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
    statusEl.style.display = 'block';

    // Auto-hide after 5 seconds (except for loading states)
    if (type !== 'loading') {
        setTimeout(() => {
            if (statusEl.style.display === 'block' && !statusEl.textContent.includes('Refreshing')) {
                statusEl.style.display = 'none';
            }
        }, 5000);
    }
}

// Utility function to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Handle action button clicks
function handleActionClick(event) {
    event.stopPropagation();
    const action = event.target.dataset.action;
    const index = parseInt(event.target.dataset.index);

    if (action === 'login') {
        loginWithAccount(index);
    } else if (action === 'delete') {
        deleteAccount(index);
    }
}
