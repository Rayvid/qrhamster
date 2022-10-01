import { fromPath } from 'pdf2pic';
import * as path from 'path'
import * as fs from 'fs'
import { Buffer } from 'buffer';
import { ToBase64Response } from 'pdf2pic/dist/types/toBase64Response'
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';

import { initializeApp, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

import * as http from 'http';
import * as url from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

initializeApp({
    credential: cert(path.resolve(__dirname, './adminsdk.json')),
    storageBucket: "qrhamsters-app.appspot.com"
})

const bucket = getStorage().bucket();

async function clearTemp(): Promise<void> {
    const dir = path.join(__dirname, './temp/');
    fs.readdir(dir, (err, files) => {
        if (err) throw err;
      
        for (const file of files) {
          fs.unlink(path.join(dir, file), err => {
            if (err) throw err;
          });
        }
      });
}

async function downloadLatestFile(userID: string): Promise<string | null> {
    const [files] = await bucket.getFiles({prefix: `users/${userID}/pdf`})

    let maxTimestamp = -1;
    let selectedFile = undefined;
    for (const file of files) {
        const fileTimestamp = parseInt(file.name.replace(`users/${userID}/pdf/`, ''));
        if (fileTimestamp > maxTimestamp) {
            selectedFile = file;
            maxTimestamp = fileTimestamp;
        }
    }
    if (selectedFile === undefined) {
        return null;
    }
    await selectedFile.download({destination: path.resolve(__dirname, `./temp/${maxTimestamp}.pdf`)});
    return `${maxTimestamp}.pdf`
}

async function uploadQR(userID: string, pdfID: string) {
    const pdfTicketPath = path.resolve(__dirname, './temp/', pdfID);
    const base64image = await fromPath(pdfTicketPath, {
        format: 'png',
        quality: 100,
    })(1, true) as ToBase64Response;

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
    const qrPath = path.resolve(__dirname, 'temp/qr.png')
    await QRCode.toFile(qrPath, qr.data);
    await bucket.upload(qrPath, {destination: `users/${userID}/qr/${pdfID.replace('.pdf', '')}_${qr.data}.png`});
}

async function main(userId: string) {
    await clearTemp();
    const pdfName = await downloadLatestFile(userId);
    if (pdfName === null) {
        console.log('No pdf files found');
        return;
    }
    await uploadQR(userId, pdfName);
    //TODO: create nft metadata json and upload it to nfts/{userId}/{timestamp} folder
}

const requestListener = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const queryObject = url.parse(req.url as string, true).query;
    if (queryObject['userId'] === undefined) {
        res.writeHead(400, {'Content-Type': 'json'});
        res.end("{'error': 'missing userId param'}");
        return;
    }

    const userId = queryObject.userId as string;
    await main(userId);

    res.writeHead(200, {'Content-Type': 'json'});
    res.end("{'success': 'QR created'}");
}

http.createServer(requestListener).listen(5050);








