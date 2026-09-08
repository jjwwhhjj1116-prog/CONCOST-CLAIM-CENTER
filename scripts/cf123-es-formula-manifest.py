"""Read OOXML formula fingerprints only. Never writes/copies source cells or customer values."""
import hashlib
import json
import sys
import zipfile
from xml.etree import ElementTree as ET

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(sys.argv[1]) as archive:
    book = ET.fromstring(archive.read('xl/workbook.xml'))
    rels = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
    manifest = {}
    for sheet in book.findall('s:sheets/s:sheet', NS):
        target = rels[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
        path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        formulas = []
        for cell in ET.fromstring(archive.read(path)).findall('.//s:sheetData/s:row/s:c', NS):
            f = cell.find('s:f', NS)
            if f is not None:
                formulas.append([cell.attrib['r'], f.text or '', *[f.attrib.get(key, '') for key in ['t', 'si', 'ref']]])
        formulas.sort(key=lambda row: row[0])
        encoded = json.dumps(formulas, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        manifest[sheet.attrib['name']] = hashlib.sha256(encoded).hexdigest()
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
