// Sadece export fonksiyonları
class ExportManager {
  // Tüm verileri JSON olarak export et
  async exportAllData() {
    try {
      const response = await fetch('/api/export');
      if (!response.ok) throw new Error('Export başarısız');
      
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      
      // Dosya adı: DUNYATEK_YYYY-MM-DD_HH-mm-ss.json
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `DUNYATEK_${timestamp}.json`;
      
      // İndir
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showMessage('Veriler başarıyla dışa aktarıldı', false);
    } catch (error) {
      showMessage('Dışa aktarım başarısız: ' + error.message, true);
    }
  }

  // Export butonu oluştur
  createExportButton() {
    const button = document.createElement('button');
    button.className = 'export-btn';
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
        <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
      </svg>
      Verileri İndir
    `;
    button.title = 'Tüm verileri dışa aktar';
    
    button.addEventListener('click', () => {
      if (confirm('Tüm verileri dışa aktarmak istediğinize emin misiniz?')) {
        this.exportAllData();
      }
    });
    
    return button;
  }
}

// Export manager instance
const exportManager = new ExportManager();

// Export butonunu sadece dashboard'da göster
function addExportButton() {
  const topbarControls = document.querySelector('.topbar-controls');
  if (!topbarControls) return;
  
  // Sadece dashboard'da göster
  if (state.view !== 'dashboard') return;
  
  // Export butonu için container
  const exportContainer = document.createElement('div');
  exportContainer.className = 'export-container';
  
  // Butonu ekle
  exportContainer.appendChild(exportManager.createExportButton());
  
  // Topbar'a ekle
  topbarControls.appendChild(exportContainer);
}

// Sayfa yüklendiğinde butonu ekle
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    addExportButton();
  }, 1000);
});

// Sayfa değiştiğinde export butonunu güncelle
function updateExportButton() {
  // Mevcut export butonunu sil
  const existingContainer = document.querySelector('.export-container');
  if (existingContainer) {
    existingContainer.remove();
  }
  
  // Yeni export butonunu ekle (sadece dashboard'da)
  addExportButton();
}
