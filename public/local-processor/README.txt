InteractDeck - Local Presentation PDF Processor
===============================================

This local processor allows you to pre-convert and compress your presentation PDF slides on your local machine before uploading. This is extremely helpful for large decks (e.g. >20 pages) because it avoids slow browser uploads, memory allocation crashes, and browser tab freezes.

It extracts each page into high-quality images under 1.5MB, compiles thumbnails, builds a metadata.json, and packages everything in a standard .zip file.

How to Use
----------

PREREQUISITE:
Ensure you have Python 3 installed on your computer. Download from: https://www.python.org/

FOR MAC AND LINUX USERS:
1. Open Terminal.
2. Navigate to the downloaded directory.
3. Make the script executable:
   chmod +x process.sh
4. Run the processor with the path to your PDF file:
   ./process.sh /path/to/your/presentation.pdf
5. An output file named "[presentation_title].zip" will be generated in your current folder.

FOR WINDOWS USERS:
1. Drag and drop your PDF file directly onto the "process.bat" file.
2. Or open Command Prompt, navigate to the folder, and run:
   process.bat "C:\path\to\your\presentation.pdf"
3. An output file named "[presentation_title].zip" will be generated in the same folder.

UPLOADING:
On the InteractDeck "Upload New Presentation" dashboard page, drag and drop the newly created .zip file instead of the PDF. The system will ingest it instantly!
