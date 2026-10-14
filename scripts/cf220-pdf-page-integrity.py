"""Compare actual raster PDF pages, resolving each page's Do operand.

Usage: python -B scripts/cf220-pdf-page-integrity.py left.pdf right.pdf result.json
The supported product format has exactly one directly painted image per page.
Forms or additional images fail rather than silently selecting a shared resource.
"""
import hashlib
import io
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DecodedStreamObject, NameObject, NumberObject


def painted(page):
    names = [args[0] for args, op in page.get_contents().operations if op == b'Do']
    assert len(names) == 1, 'Expected one painted page image'
    obj = page['/Resources']['/XObject'][names[0]]
    assert obj['/Subtype'] == '/Image', 'Forms require a separate verifier'
    assert not any(key in obj for key in ['/Decode', '/DecodeParms', '/SMask', '/Mask', '/Alternates', '/Interpolate']), 'Unsupported image rendering attributes'
    assert obj['/ColorSpace'] == '/DeviceRGB' and obj['/BitsPerComponent'] == 8, 'Expected 8-bit RGB page image'
    assert obj['/Filter'] == '/DCTDecode', 'Expected direct JPEG page image'
    data = obj.get_data()
    image = Image.open(io.BytesIO(data)).convert('RGBA')
    assert image.size == (obj['/Width'], obj['/Height']), 'PDF image dimensions differ from encoded image'
    return str(names[0]), data, image


def compare(left, right):
    assert len(left.pages) == len(right.pages), 'Page count changed'
    result = []
    for index, (a, b) in enumerate(zip(left.pages, right.pages), 1):
        assert list(a.mediabox) == list(b.mediabox), f'Page {index} MediaBox changed'
        assert list(a.cropbox) == list(b.cropbox), f'Page {index} CropBox changed'
        assert a.get('/Rotate', 0) == b.get('/Rotate', 0), f'Page {index} rotation changed'
        assert a.get_contents().get_data() == b.get_contents().get_data(), f'Page {index} placement/content changed'
        an, ad, ai = painted(a)
        bn, bd, bi = painted(b)
        assert an == bn, f'Page {index} image operand changed'
        assert ai.size == bi.size, f'Page {index} image size changed'
        diff = ImageChops.difference(ai, bi)
        mask = diff.getchannel(0)
        for channel in diff.split()[1:]:
            mask = ImageChops.lighter(mask, channel)
        changed = sum(mask.histogram()[1:])
        assert changed == 0, f'Page {index} has {changed} changed pixels'
        assert ad == bd, f'Page {index} encoded image changed'
        result.append({'page': index, 'Do': an, 'size': ai.size,
                       'imageSha256': hashlib.sha256(ad).hexdigest(), 'changedPixels': changed})
    return result


def altered(source, change):
    writer = PdfWriter()
    writer.clone_document_from_reader(source)
    change(writer)
    stream = io.BytesIO()
    writer.write(stream)
    return PdfReader(io.BytesIO(stream.getvalue()))


def negatives(source):
    assert len(source.pages) >= 2, 'Negative tests require distinct pages'
    def placement(writer):
        page = writer.pages[1]
        stream = DecodedStreamObject()
        stream.set_data(b'1 0 0 1 0.01 0 cm\n' + page.get_contents().get_data())
        page[NameObject('/Contents')] = stream
    def image_pixel(writer):
        page = writer.pages[1]
        name, data, _ = painted(page)
        image = Image.open(io.BytesIO(data)).convert('RGB')
        r, g, b = image.getpixel((0, 0))
        image.putpixel((0, 0), ((r + 128) % 256, g, b))
        encoded = io.BytesIO()
        image.save(encoded, format='JPEG', quality=95)
        obj = DecodedStreamObject()
        for key, value in page['/Resources']['/XObject'][name].items():
            if key != '/Length':
                obj[key] = value
        obj.set_data(encoded.getvalue())
        page['/Resources']['/XObject'][NameObject(name)] = obj
    def decode_inversion(writer):
        page = writer.pages[1]
        name, _, _ = painted(page)
        page['/Resources']['/XObject'][name][NameObject('/Decode')] = ArrayObject([NumberObject(v) for v in [1, 0, 1, 0, 1, 0]])
    cases = [('missing-page', lambda w: w.remove_page(1)),
             ('swapped-pages', lambda w: w.pages[0].__setitem__(NameObject('/Contents'), w.pages[1]['/Contents'])),
             ('position-change', placement), ('painted-second-image-pixel', image_pixel), ('decode-inversion', decode_inversion)]
    results = []
    for name, change in cases:
        candidate = altered(source, change)
        try:
            compare(source, candidate)
        except AssertionError as error:
            results.append({'case': name, 'rejected': True, 'reason': str(error)})
        else:
            raise AssertionError(f'Negative accepted: {name}')
    return results


if __name__ == '__main__':
    left, right, output = map(Path, sys.argv[1:4])
    a, b = PdfReader(left), PdfReader(right)
    result = {'left': str(left), 'right': str(right), 'pages': compare(a, b),
              'negatives': negatives(a), 'passed': True}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))
