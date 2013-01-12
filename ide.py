#! /usr/bin/env python

"""
    ide.py - writes request body to disk block named by 
    'block' query parameter, returns bool as 0 or 1.
"""

import os
import sys
import cgi
import cgitb
import urlparse

cgitb.enable()

query = urlparse.parse_qs( 
                os.environ['QUERY_STRING'] )

print 'Content-Type: text/plain'
print

if 'block' in query and 'offset' in query:
    block = query['block'][0]
    try:
        if not block.startswith('hda'):
            raise Exception()
        offset = int(query['offset'][0])
        
        fp = open(block, 'r+')
        fp.seek(offset)
        fp.write(sys.stdin.read())
        fp.close()
        print 1
    except:
        print 0
else:
    print 0

