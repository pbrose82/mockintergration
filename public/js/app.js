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

// Transfer material to Alchemy
async function transferMaterial(materialId) {
    const row = document.querySelector(`tr[data-material-id="${materialId}"]`);
    const button = row.querySelector('.btn-transfer');
    
    // Show loading state
    button.disabled = true;
    button.innerHTML = 'Transferring... <span class="spinner"></span>';
    
    try {
        const response = await fetch('/api/transfer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ materialId })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            // Update the UI
            const statusCell = row.querySelector('.transfer-status');
            statusCell.textContent = 'Transferred';
            statusCell.classList.remove('pending');
            statusCell.classList.add('transferred');
            
            // Update Alchemy code
            const codeCell = row.cells[5];
            codeCell.innerHTML = data.alchemyCode;
            
            // Replace button with link
            const actionCell = row.cells[6];
            actionCell.innerHTML = `<a href="${data.alchemyUrl}" target="_blank" class="btn btn-sm btn-view">View in Alchemy</a>`;
            
            // Show success message
            showNotification('Material successfully transferred to Alchemy!', 'success');
        } else {
            throw new Error(data.message || 'Transfer failed');
        }
    } catch (error) {
        console.error('Transfer error:', error);
        button.disabled = false;
        button.textContent = 'Transfer to Alchemy';
        showNotification(`Transfer failed: ${error.message}`, 'error');
    }
}

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

// Show notification
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `alert alert-${type}`;
    notification.textContent = message;
    notification.style.position = 'fixed';
    notification.style.top = '80px';
    notification.style.right = '20px';
    notification.style.zIndex = '1001';
    notification.style.minWidth = '300px';
    notification.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
    
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
