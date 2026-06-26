document.addEventListener('DOMContentLoaded', () => {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('xmlFile');
  const dropText = document.getElementById('dropText');
  const form = document.getElementById('translateForm');
  const translateBtn = document.getElementById('translateBtn');
  const btnText = document.querySelector('.btn-text');
  const spinner = document.querySelector('.spinner');
  const resultArea = document.getElementById('resultArea');
  const downloadLink = document.getElementById('downloadLink');
  const errorArea = document.getElementById('errorArea');
  const errorMsg = document.getElementById('errorMsg');
  const resetBtn = document.getElementById('resetBtn');

  // Handle Drag and Drop
  dropZone.addEventListener('click', () => fileInput.click());

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    
    if (files.length) {
      fileInput.files = files;
      updateDropZoneText(files[0].name);
    }
  });

  fileInput.addEventListener('change', function() {
    if (this.files.length) {
      updateDropZoneText(this.files[0].name);
    }
  });

  function updateDropZoneText(filename) {
    dropText.textContent = `Selected: ${filename}`;
    dropZone.classList.add('has-file');
    errorArea.classList.add('hidden');
  }

  // Handle Form Submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!fileInput.files.length) {
      showError("Please select an XML file to translate.");
      return;
    }

    const file = fileInput.files[0];

    // Read file content as text
    const reader = new FileReader();
    reader.onload = async (event) => {
      const xmlContent = event.target.result;
      
      // Get other form values
      const formData = new FormData(form);
      const targetLanguages = formData.getAll('targetLanguages');
      const protectedTerms = formData.get('protectedTerms');

      const payload = {
        xmlContent,
        targetLanguages,
        protectedTerms
      };

      // Update UI state
      translateBtn.disabled = true;
      btnText.textContent = 'Translating...';
      spinner.classList.remove('hidden');
      errorArea.classList.add('hidden');
      resultArea.classList.add('hidden');

      try {
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Translation failed.');
        }

        // Handle file download
        const blob = new Blob([data.xmlContent], { type: 'application/xml' });
        const url = window.URL.createObjectURL(blob);
        
        downloadLink.href = url;
        // Extract original filename to create cloned filename
        const originalName = file.name;
        const downloadName = originalName.replace('.xml', '.xdefault-cloned.xml');
        downloadLink.download = downloadName;
        
        resultArea.classList.remove('hidden');

      } catch (error) {
        showError(error.message);
      } finally {
        // Reset UI state
        translateBtn.disabled = false;
        btnText.textContent = 'Translate XML';
        spinner.classList.add('hidden');
      }
    };

    reader.onerror = () => {
      showError("Failed to read the XML file on the client.");
    };

    reader.readAsText(file);
  });

  resetBtn.addEventListener('click', () => {
    form.reset();
    dropText.textContent = 'Drag & drop your XML file here, or click to select';
    dropZone.classList.remove('has-file');
    resultArea.classList.add('hidden');
    errorArea.classList.add('hidden');
    fileInput.value = '';
  });

  function showError(msg) {
    errorMsg.textContent = msg;
    errorArea.classList.remove('hidden');
  }
});
