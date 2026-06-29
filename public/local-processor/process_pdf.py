import os
import sys
import json
import zipfile
import math

def process_pdf(pdf_path):
    if not os.path.exists(pdf_path):
        print(f"Error: File '{pdf_path}' not found.")
        sys.exit(1)

    print("Loading PyMuPDF library...")
    try:
        import fitz  # PyMuPDF
    except ImportError:
        print("PyMuPDF is not installed. Installing automatically...")
        ret = os.system(f"\"{sys.executable}\" -m pip install pymupdf")
        if ret != 0:
            print("Standard pip install failed. Retrying with --break-system-packages (for externally managed environments)...")
            os.system(f"\"{sys.executable}\" -m pip install pymupdf --break-system-packages")
        import fitz

    print(f"Opening PDF file: {pdf_path}")
    doc = fitz.open(pdf_path)
    num_pages = len(doc)
    print(f"Total pages to process: {num_pages}")

    # Create output directory
    pdf_filename = os.path.basename(pdf_path)
    title = os.path.splitext(pdf_filename)[0]
    output_dir = f"processed_{title}"
    os.makedirs(output_dir, exist_ok=True)

    metadata = {
        "title": title,
        "slideCount": num_pages,
        "slides": []
    }

    for page_idx in range(num_pages):
        page_num = page_idx + 1
        print(f"Processing slide {page_num} of {num_pages}...")
        page = doc.load_page(page_idx)

        # Calculate aspect ratio
        rect = page.rect
        aspect_ratio = rect.width / rect.height

        # Render High Resolution slide (scale = 2.0)
        zoom = 2.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        
        # Keep file under 1.5MB limit
        img_bytes = pix.tobytes("png")
        ext = "png"
        
        if len(img_bytes) > 1.5 * 1024 * 1024:
            print(f"  Slide {page_num} PNG exceeds 1.5MB. Converting to JPEG with compression...")
            img_bytes = pix.tobytes("jpg", jpg_quality=85)
            ext = "jpg"

        high_res_name = f"slide_{page_num}.{ext}"
        high_res_path = os.path.join(output_dir, high_res_name)
        with open(high_res_path, "wb") as f:
            f.write(img_bytes)

        # Render Low Resolution thumbnail (scale = 0.4)
        thumb_zoom = 0.4
        thumb_mat = fitz.Matrix(thumb_zoom, thumb_zoom)
        thumb_pix = page.get_pixmap(matrix=thumb_mat)
        
        thumb_name = f"thumb_{page_num}.png"
        thumb_path = os.path.join(output_dir, thumb_name)
        thumb_pix.save(thumb_path)

        metadata["slides"].append({
            "pageNum": page_num,
            "aspectRatio": round(aspect_ratio, 4),
            "imageName": high_res_name,
            "thumbName": thumb_name
        })

    # Save metadata.json
    metadata_path = os.path.join(output_dir, "metadata.json")
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    # Zip everything
    zip_filename = f"{title}.zip"
    print(f"Zipping processed assets into '{zip_filename}'...")
    
    with zipfile.ZipFile(zip_filename, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for file in os.listdir(output_dir):
            file_path = os.path.join(output_dir, file)
            zip_file.write(file_path, file)

    # Clean up local temp directory
    print("Cleaning up temporary files...")
    for file in os.listdir(output_dir):
        os.remove(os.path.join(output_dir, file))
    os.rmdir(output_dir)

    print(f"\nSuccess! Processed slide deck saved as: {zip_filename}")
    print("You can now upload this zip file directly on the dashboard.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python process_pdf.py <path_to_pdf>")
        sys.exit(1)
    
    process_pdf(sys.argv[1])
