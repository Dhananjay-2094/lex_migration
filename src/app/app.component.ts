import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LexMigrationService } from './lex-migration.service';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'lex_migration';
  description = "";
  lexV1FileContent: any;
  fileName = "";
  isGenerating = false;
  statusMessage = "";

  constructor(private readonly lexMigrationService: LexMigrationService) { }

  uploadLexV1Json(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        this.lexV1FileContent = JSON.parse(reader.result as string);
        this.fileName = file.name;
        this.statusMessage = "Lex V1 JSON loaded. Ready to generate.";
      } catch (err) {
        this.lexV1FileContent = null;
        this.fileName = "";
        this.statusMessage = "";
        alert('Invalid JSON file.');
      }
    };
    reader.readAsText(file);
  }

  async generateLexV2Zip() {
    if (!this.lexV1FileContent) {
      alert('Upload a valid Lex V1 JSON file first.');
      return;
    }

    this.isGenerating = true;
    this.statusMessage = "Generating Lex V2 and Lambda ZIP files...";

    try {
      const archives = await this.lexMigrationService.generateArchives(this.lexV1FileContent, this.description);
      await this.saveWithPrompt(archives.lexZip, `${archives.botName}_Lex.zip`);
      await this.saveWithPrompt(archives.lambdaZip, `${archives.botName}_Lambda.zip`);
      this.statusMessage = "ZIP files generated successfully.";
    } finally {
      this.isGenerating = false;
    }
  }

  async saveWithPrompt(blob: Blob, fileName: string) {
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: fileName,
          types: [
            {
              description: 'ZIP file',
              accept: { 'application/zip': ['.zip'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err) {
        console.error('User aborted or failed to save file:', err);
        return;
      }
    }

    this.downloadBlob(blob, fileName);
  }

  private downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
