// Generate self-signed SSL certificate using Node.js (no OpenSSL needed!)
const fs = require('fs');
const path = require('path');

console.log('🔐 Generating self-signed SSL certificate for localhost...\n');

const certDir = path.join(__dirname, 'ssl');
const certFile = path.join(certDir, 'cert.pem');
const keyFile = path.join(certDir, 'key.pem');

// Create ssl directory
if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
    console.log('📁 Created ssl/ directory\n');
}

// Check if cert already exists
if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    console.log('✓ SSL certificate already exists!');
    console.log(`  📄 ${certFile}`);
    console.log(`  🔑 ${keyFile}\n`);
    console.log('Ready to use! Run: npm start\n');
    process.exit(0);
}

// Use node-forge to generate certificate (pure JavaScript, no external tools)
console.log('Installing node-forge (required for certificate generation)...\n');

const { execSync } = require('child_process');

try {
    // Install node-forge if not present
    execSync('npm list node-forge', { stdio: 'ignore' });
} catch (e) {
    console.log('Installing node-forge...');
    try {
        execSync('npm install --save-dev node-forge', { stdio: 'inherit' });
    } catch (err) {
        console.error('❌ Failed to install node-forge');
        console.error('Try manually: npm install --save-dev node-forge');
        process.exit(1);
    }
}

console.log('\nGenerating certificate...\n');

try {
    const forge = require('node-forge');
    const pki = forge.pki;

    // Generate key pair
    console.log('Generating RSA key pair (2048-bit)...');
    const keys = pki.rsa.generateKeyPair(2048);

    // Create certificate
    console.log('Creating certificate...');
    const cert = pki.createCertificate();

    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);

    const attrs = [
        { name: 'commonName', value: 'localhost' },
        { name: 'organizationName', value: 'PRMSU Navigator' },
        { name: 'countryName', value: 'PH' }
    ];

    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
        {
            name: 'basicConstraints',
            cA: false
        },
        {
            name: 'keyUsage',
            keyCertSign: false,
            digitalSignature: true,
            nonRepudiation: true,
            keyEncipherment: true,
            dataEncipherment: true
        },
        {
            name: 'subjectAltName',
            altNames: [
                { type: 2, value: 'localhost' },
                { type: 2, value: '127.0.0.1' }
            ]
        }
    ]);

    console.log('Signing certificate...');
    cert.sign(keys.privateKey, forge.md.sha256.create());

    // Convert to PEM format
    const certPem = pki.certificateToPem(cert);
    const keyPem = pki.privateKeyToPem(keys.privateKey);

    // Write to files
    console.log('Writing certificate files...');
    fs.writeFileSync(certFile, certPem);
    fs.writeFileSync(keyFile, keyPem);

    console.log('\n✓ SSL certificate generated successfully!\n');
    console.log(`  📄 Cert: ${certFile}`);
    console.log(`  🔑 Key:  ${keyFile}\n`);
    console.log('✓ Ready to start the server!\n');
    console.log('Next steps:');
    console.log('  1. npm start');
    console.log('  2. Visit https://localhost:3000\n');

} catch (error) {
    console.error('❌ Error generating certificate:', error.message);
    console.log('\nTroubleshooting:');
    console.log('1. Make sure node-forge is installed:');
    console.log('   npm install --save-dev node-forge\n');
    console.log('2. Then run again:');
    console.log('   npm run cert\n');
    process.exit(1);
}
