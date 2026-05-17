// Wait for DOM to be ready
    document.addEventListener('DOMContentLoaded', function() {
      loadDocumentation();
    });
    
    // Enhanced markdown to HTML converter
    function markdownToHTML(markdown) {
      let html = markdown;
      
      // Code blocks first (to avoid processing content inside)
      const codeBlocks = [];
      html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        const id = `code-${codeBlocks.length}`;
        codeBlocks.push({ id, lang: lang || '', code });
        return `__CODE_BLOCK_${id}__`;
      });
      
      // Headers (order matters - most specific first)
      html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
      html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
      html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
      html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
      
      // Horizontal rules
      html = html.replace(/^---$/gim, '<hr>');
      html = html.replace(/^\*\*\*$/gim, '<hr>');
      
      // Blockquotes
      html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');
      
      // Lists - process numbered and bulleted
      const lines = html.split('\n');
      let processedLines = [];
      let inList = false;
      let listType = null;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const bulletMatch = line.match(/^[\*\-\+] (.+)$/);
        const numberMatch = line.match(/^\d+\. (.+)$/);
        
        if (bulletMatch || numberMatch) {
          const content = bulletMatch ? bulletMatch[1] : numberMatch[1];
          const currentType = bulletMatch ? 'ul' : 'ol';
          
          if (!inList || listType !== currentType) {
            if (inList) {
              processedLines.push(`</${listType}>`);
            }
            processedLines.push(`<${currentType}>`);
            inList = true;
            listType = currentType;
          }
          processedLines.push(`<li>${content}</li>`);
        } else {
          if (inList) {
            processedLines.push(`</${listType}>`);
            inList = false;
            listType = null;
          }
          processedLines.push(line);
        }
      }
      
      if (inList) {
        processedLines.push(`</${listType}>`);
      }
      
      html = processedLines.join('\n');
      
      // Bold and italic (order matters)
      html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
      html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
      
      // Inline code (after bold/italic to avoid conflicts)
      html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
      
      // Links
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
      
      // Restore code blocks
      codeBlocks.forEach(({ id, lang, code }) => {
        html = html.replace(`__CODE_BLOCK_${id}__`, `<pre><code class="language-${lang}">${escapeHTML(code)}</code></pre>`);
      });
      
      // Tables
      html = html.replace(/\|(.+)\|\n\|[-\s|]+\|\n((?:\|.+\|\n?)+)/g, (match, header, rows) => {
        const headers = header.split('|').filter(h => h.trim()).map(h => h.trim());
        const rowLines = rows.trim().split('\n').filter(r => r.trim());
        
        let table = '<table><thead><tr>';
        headers.forEach(h => table += `<th>${h}</th>`);
        table += '</tr></thead><tbody>';
        
        rowLines.forEach(row => {
          const cells = row.split('|').filter(c => c.trim()).map(c => c.trim());
          table += '<tr>';
          cells.forEach(cell => table += `<td>${cell}</td>`);
          table += '</tr>';
        });
        
        table += '</tbody></table>';
        return table;
      });
      
      // Paragraphs (lines that aren't already HTML)
      html = html.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return '';
        if (trimmed.match(/^<[^>]+>/) || trimmed.match(/^<\/[^>]+>/) || 
            trimmed.match(/^<li>/) || trimmed.match(/^<ul>/) || trimmed.match(/^<\/ul>/) ||
            trimmed.match(/^<ol>/) || trimmed.match(/^<\/ol>/) || trimmed.match(/^<h[1-6]>/) ||
            trimmed.match(/^<pre>/) || trimmed.match(/^<\/pre>/) || trimmed.match(/^<table>/) ||
            trimmed.match(/^<\/table>/) || trimmed.match(/^<hr>/) || trimmed.match(/^<blockquote>/)) {
          return line;
        }
        return `<p>${line}</p>`;
      }).filter(l => l).join('\n');
      
      return html;
    }
    
    function escapeHTML(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    // Load documentation function
    function loadDocumentation() {
      // Get file parameter from URL
      const urlParams = new URLSearchParams(window.location.search);
      const file = urlParams.get('file');
      
      console.log('[Markdown Viewer] File parameter:', file);
      
      const contentDiv = document.getElementById('content');
      if (!contentDiv) {
        console.error('[Markdown Viewer] Content div not found!');
        return;
      }
      
      if (!file) {
        contentDiv.innerHTML = '<div class="error">No file specified. Use ?file=FILENAME.md</div>';
        return;
      }
      
      const fileUrl = `/${file}`;
      
      console.log('[Markdown Viewer] Fetching:', fileUrl);
      
      // Try to load the markdown file
      fetch(fileUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/markdown, text/plain, */*'
        },
        cache: 'no-cache'
      })
        .then(response => {
          console.log('[Markdown Viewer] Response status:', response.status, response.statusText);
          
          if (!response.ok) {
            throw new Error(`Failed to load: ${response.status} ${response.statusText}. Please ensure the server is running and the file exists.`);
          }
          return response.text();
        })
        .then(markdown => {
          console.log('[Markdown Viewer] Received markdown, length:', markdown.length);
          if (!markdown || markdown.trim().length === 0) {
            throw new Error('Received empty file content');
          }
          const html = markdownToHTML(markdown);
          console.log('[Markdown Viewer] Converted to HTML, length:', html.length);
          contentDiv.innerHTML = html;
          console.log('[Markdown Viewer] Content updated successfully');
        })
        .catch(error => {
          console.error('[Markdown Viewer] Error loading documentation:', error);
          contentDiv.innerHTML = `
            <div class="error">
              <h3>Error loading documentation</h3>
              <p><strong>Error:</strong> ${error.message}</p>
              <p><strong>File requested:</strong> ${file}</p>
              <p><strong>URL:</strong> ${fileUrl}</p>
              <p><strong>Possible solutions:</strong></p>
              <ul>
                <li>Ensure the server is running on port 3000</li>
                <li>Check that the file ${file} exists in the server directory</li>
                <li>Verify the server routes are properly configured</li>
                <li>Check browser console (F12) for more details</li>
                <li>Try accessing directly: <a href="${fileUrl}" target="_blank">${fileUrl}</a></li>
              </ul>
              <p><a href="/" style="color: #58a6ff;">← Back to IDE</a></p>
            </div>
          `;
        });
    }
  