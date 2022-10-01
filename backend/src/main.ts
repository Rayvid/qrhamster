import { fromPath } from 'pdf2pic';
import * as path from 'path'
import { Buffer } from 'buffer';
import { ToBase64Response } from 'pdf2pic/dist/types/toBase64Response'
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
    const pdfTicketPath = path.resolve(__dirname, './ticket.pdf');
    const convert = fromPath(pdfTicketPath, {
        format: 'png',
        quality: 100,
    });
    const base64image = await convert(1, true) as ToBase64Response;
    const dataUri = base64image?.base64;
    if (dataUri === undefined || base64image.size == '0') {
        throw(new Error('Could not extract image base64'));
    }
    const buffer = Buffer.from(dataUri, 'base64');
    const png = PNG.sync.read(buffer);

    const qr = jsQR(Uint8ClampedArray.from(png.data), png.width, png.height);
    if (qr === null) {
        throw(new Error('Could not scan qr code'));
    }
    console.log(qr.data);
    await QRCode.toFile(path.resolve(__dirname, './qr.png'), qr.data);
}

await main();







