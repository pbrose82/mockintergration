// Frontend JavaScript for MockERP Pro

// Show/hide add material form
function showAddMaterialForm() {
    document.getElementById('addMaterialForm').style.display = 'block';
    document.getElementById('tradeName').focus();
}

function hideAddMaterialForm() {
    document.getElementById('addMaterialForm').style.display = 'none';
    document.getElementById('addMaterialForm').querySelector('form').reset();
}

// --- THIS IS THE UPDATED FUNCTION ---
// Transfer material to Alchemy
async function transferMaterial(materialId) {
    const row = document.querySelector(`tr[data-material-id="${materialId}"]`);
    const button = row.querySelector('.btn-transfer');

    // Show loading state
    button.disabled = true;
    button.innerHTML = '🔄 Transferring... <span class="spinner"></span>';

    try {
        // NEW: Get the material data directly from the table row's cells.
        // (Assumes standard column order: TradeName, Category, Status)
        const materialData = {
            TradeName: row.cells[1].textContent.trim(),
            Category: row.cells[2].textContent.trim(),
            MaterialStatus: row.cells[3].textContent.trim()
        };

        // NEW: Send the FULL materialData object to the backend.
        // This is the new, corrected code
        const serverUrl = 'https://mockintergration.onrender.com';
        const response = await fetch(`${serverUrl}/api/transfer`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(materialData) // We send the data, not just the ID
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Update the UI (this part remains the same)
            const statusCell = row.querySelector('.transfer-status');
            statusCell.textContent = 'Transferred';
            statusCell.classList.remove('pending');
            statusCell.classList.add('transferred');

            // Update Alchemy code
            const codeCell = row.cells[5];
            codeCell.innerHTML = data.alchemyCode;

            // Replace button with link
            const actionCell = row.cells[6];
            actionCell.innerHTML = `
                <a href="${data.alchemyUrl}" target="_blank" class="btn btn-sm btn-view">👁️ View in Alchemy</a>
                <button class="btn btn-sm btn-secondary" onclick="revertMaterial('${materialId}')" title="This is a mock action">↩️ Revert</button>
            `;

            // Show success message
            showNotification(`Material successfully transferred! Code: ${data.alchemyCode}`, 'success');
        } else {
            throw new Error(data.message || 'Transfer failed');
        }
    } catch (error) {
        console.error('Transfer error:', error);
        button.disabled = false;
        button.innerHTML = '📤 Transfer to Alchemy';
        showNotification(`Transfer failed: ${error.message}`, 'error');
    }
}
// --- END OF UPDATED FUNCTION ---


// Test connection (admin page)
async function testConnection() {
    const button = event.target;
    const resultDiv = document.getElementById('connectionResult');

    button.disabled = true;
    button.innerHTML = 'Testing... <span class="spinner"></span>';
    resultDiv.style.display = 'none';

    try {
        const response = await fetch('/api/test-connection', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        resultDiv.style.display = 'block';

        if (response.ok && data.success) {
            resultDiv.className = 'connection-result success';
            resultDiv.textContent = '✓ ' + data.message;
        } else {
            resultDiv.className = 'connection-result error';
            resultDiv.textContent = '✗ ' + data.message;
        }
    } catch (error) {
        resultDiv.style.display = 'block';
        resultDiv.className = 'connection-result error';
        resultDiv.textContent = '✗ Connection test failed: ' + error.message;
    } finally {
        button.disabled = false;
        button.textContent = 'Test Connection';
    }
}

// Change tenant quickly
async function changeTenant() {
    const tenantSpan = Array.from(document.querySelectorAll('.config-item')).find(item =>
        item.querySelector('label')?.textContent.includes('Tenant:')
    )?.querySelector('span');
    const currentTenant = tenantSpan ? tenantSpan.textContent : 'unknown';
    const newTenant = prompt(`Current tenant: ${currentTenant}\n\nEnter new tenant name:`);

    if (newTenant && newTenant.trim()) {
        try {
            const response = await fetch('/api/change-tenant', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ tenant: newTenant.trim() })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                showNotification(data.message, 'success');
                setTimeout(() => location.reload(), 1500);
            } else {
                showNotification(data.message || 'Failed to change tenant', 'error');
            }
        } catch (error) {
            showNotification('Error changing tenant: ' + error.message, 'error');
        }
    }
}

// Clear stored authentication token
async function clearToken() {
    if (confirm('Clear the stored authentication token? Next API call will re-authenticate.')) {
        try {
            const response = await fetch('/api/clear-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (response.ok && data.success) {
                showNotification(data.message, 'success');
            } else {
                showNotification('Failed to clear token', 'error');
            }
        } catch (error) {
            showNotification('Error clearing token: ' + error.message, 'error');
        }
    }
}

// Show notification with modern styling
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `alert alert-${type}`;
    notification.innerHTML = `
        <span style="font-size: 1.25rem; margin-right: 0.5rem;">
            ${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}
        </span>
        ${message}
    `;
    notification.style.position = 'fixed';
    notification.style.top = '80px';
    notification.style.right = '20px';
    notification.style.zIndex = '1001';
    notification.style.minWidth = '300px';
    notification.style.boxShadow = '0 10px 25px rgba(0,0,0,0.2)';
    notification.style.animation = 'slideInRight 0.3s ease';

    document.body.appendChild(notification);

    // Fade in
    notification.style.opacity = '0';
    setTimeout(() => {
        notification.style.transition = 'opacity 0.3s';
        notification.style.opacity = '1';
    }, 10);

    // Remove after 5 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(20px)';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 5000);
}

// Add keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl+N or Cmd+N to add new material
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        const addForm = document.getElementById('addMaterialForm');
        if (addForm) {
            showAddMaterialForm();
        }
    }

    // Escape to close forms
    if (e.key === 'Escape') {
        const addForm = document.getElementById('addMaterialForm');
        if (addForm && addForm.style.display !== 'none') {
            hideAddMaterialForm();
        }
    }
});

// Auto-refresh data every 30 seconds (for demo purposes)
if (window.location.pathname === '/') {
    setInterval(() => {
        // In a real app, this would fetch updated data via AJAX
        console.log('Auto-refresh check (in real app, would check for updates)');
    }, 30000);
}

// Add some demo interactivity
document.addEventListener('DOMContentLoaded', () => {
    // Highlight rows on hover
    const rows = document.querySelectorAll('.materials-table tbody tr');
    rows.forEach(row => {
        row.addEventListener('mouseenter', () => {
            row.style.transform = 'translateX(2px)';
            row.style.transition = 'transform 0.2s';
        });
        row.addEventListener('mouseleave', () => {
            row.style.transform = 'translateX(0)';
        });
    });

    // Add click-to-copy for Alchemy codes
    const codeCells = document.querySelectorAll('.materials-table td:nth-child(6)');
    codeCells.forEach(cell => {
        if (cell.textContent.trim() !== '-') {
            cell.style.cursor = 'pointer';
            cell.title = 'Click to copy';
            cell.addEventListener('click', () => {
                navigator.clipboard.writeText(cell.textContent.trim());
                showNotification('Code copied to clipboard!', 'success');
            });
        }
    });
});

// About dialog functions
function showAboutDialog() {
    document.getElementById('aboutDialog').style.display = 'flex';
}

function closeAboutDialog() {
    document.getElementById('aboutDialog').style.display = 'none';
}

// Close modal when clicking outside of it
window.onclick = function(event) {
    const modal = document.getElementById('aboutDialog');
    if (event.target === modal) {
        modal.style.display = 'none';
    }
}

// Delete material
async function deleteMaterial(materialId) {
    if (!confirm('Are you sure you want to delete this material?')) {
        return;
    }

    try {
        const response = await fetch(`/api/delete-material/${materialId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showNotification('Material deleted successfully!', 'success');
            setTimeout(() => location.reload(), 1000);
        } else {
            throw new Error(data.message || 'Delete failed');
        }
    } catch (error) {
        showNotification(`Delete failed: ${error.message}`, 'error');
    }
}

// Revert material to pending status
async function revertMaterial(materialId) {
    if (!confirm('Revert this material to pending status? This will remove its Alchemy code.')) {
        return;
    }

    try {
        const response = await fetch(`/api/revert-material/${materialId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showNotification('Material reverted to pending status!', 'success');
            setTimeout(() => location.reload(), 1000);
        } else {
            throw new Error(data.message || 'Revert failed');
        }
    } catch (error) {
        showNotification(`Revert failed: ${error.message}`, 'error');
    }
}
