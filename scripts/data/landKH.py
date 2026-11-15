# This file is for importing the land surface temperature from Sentinel-3 satellite

import pystac_client
import planetary_computer

catalog = pystac_client.Client.open(
     "https://planetarycomputer.microsoft.com/api/stac/v1",
        modifier=planetary_computer.sign_inplace,
)

print(catalog)