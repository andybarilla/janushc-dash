import * as FileSystem from 'expo-file-system/legacy';
import { PDFDocument } from 'pdf-lib';
import DocumentScanner, { ResponseType } from 'react-native-document-scanner-plugin';

// Launches the native document scanner, then assembles the returned JPEG pages
// into a single PDF written to the app cache. Returns the PDF's file URI, or null
// when the user cancels or no pages are captured. croppedImageQuality keeps a
// multi-page PDF well under the backend's 50 MB cap.
export async function scanToPdf(): Promise<string | null> {
  const { scannedImages, status } = await DocumentScanner.scanDocument({
    croppedImageQuality: 60,
    responseType: ResponseType.ImageFilePath,
  });
  if (status !== 'success' || !scannedImages || scannedImages.length === 0) {
    return null;
  }

  const doc = await PDFDocument.create();
  for (const uri of scannedImages) {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const img = await doc.embedJpg(base64);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }

  const pdfBase64 = await doc.saveAsBase64();
  const path = `${FileSystem.cacheDirectory}janushc-scan-${Date.now()}.pdf`;
  await FileSystem.writeAsStringAsync(path, pdfBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}
