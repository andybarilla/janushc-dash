import { scanToPdf } from './scan';

const mockScanDocument = jest.fn();
const mockEmbedJpg = jest.fn();
const mockAddPage = jest.fn();
const mockDrawImage = jest.fn();
const mockSaveAsBase64 = jest.fn();
const mockRead = jest.fn();
const mockWrite = jest.fn();

jest.mock('react-native-document-scanner-plugin', () => ({
  __esModule: true,
  default: { scanDocument: (...args: unknown[]) => mockScanDocument(...args) },
  ResponseType: { ImageFilePath: 'imageFilePath', Base64: 'base64' },
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64' },
  readAsStringAsync: (...args: unknown[]) => mockRead(...args),
  writeAsStringAsync: (...args: unknown[]) => mockWrite(...args),
}));

jest.mock('pdf-lib', () => ({
  PDFDocument: {
    create: async () => ({
      embedJpg: (...args: unknown[]) => mockEmbedJpg(...args),
      addPage: (...args: unknown[]) => mockAddPage(...args),
      saveAsBase64: (...args: unknown[]) => mockSaveAsBase64(...args),
    }),
  },
}));

beforeEach(() => {
  mockScanDocument.mockReset();
  mockEmbedJpg.mockReset();
  mockAddPage.mockReset();
  mockDrawImage.mockReset();
  mockSaveAsBase64.mockReset();
  mockRead.mockReset();
  mockWrite.mockReset();

  mockEmbedJpg.mockResolvedValue({ width: 100, height: 200 });
  mockAddPage.mockReturnValue({ drawImage: (...args: unknown[]) => mockDrawImage(...args) });
  mockSaveAsBase64.mockResolvedValue('PDF_BASE64');
  mockRead.mockResolvedValue('IMG_BASE64');
  mockWrite.mockResolvedValue(undefined);
});

test('returns null when the user cancels', async () => {
  mockScanDocument.mockResolvedValue({ status: 'cancel', scannedImages: [] });
  expect(await scanToPdf()).toBeNull();
  expect(mockWrite).not.toHaveBeenCalled();
});

test('returns null when no images come back', async () => {
  mockScanDocument.mockResolvedValue({ status: 'success', scannedImages: [] });
  expect(await scanToPdf()).toBeNull();
});

test('assembles all pages into one PDF and writes it to cache', async () => {
  mockScanDocument.mockResolvedValue({
    status: 'success',
    scannedImages: ['file:///a.jpg', 'file:///b.jpg'],
  });

  const uri = await scanToPdf();

  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(mockEmbedJpg).toHaveBeenCalledTimes(2);
  expect(mockEmbedJpg).toHaveBeenCalledWith('IMG_BASE64');
  expect(mockDrawImage).toHaveBeenCalledTimes(2);
  expect(mockWrite).toHaveBeenCalledWith(
    expect.stringContaining('file:///cache/'),
    'PDF_BASE64',
    { encoding: 'base64' },
  );
  expect(uri).toEqual(expect.stringContaining('file:///cache/'));
  expect(uri).toEqual(expect.stringContaining('.pdf'));
});
