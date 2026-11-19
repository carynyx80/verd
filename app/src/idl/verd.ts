/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/verd.json`.
 */
export type Verd = {
  "address": "3ty1t4idNWNRgVFzwoTqYKZBz2SLTaLtYv6WbGEe3nzN",
  "metadata": {
    "name": "verd",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Verd: IPO-style launchpad for AI agents on Solana"
  },
  "instructions": [
    {
      "name": "cancelOrder",
      "docs": [
        "Withdraw an order before the book closes. Full refund, order account closed."
      ],
      "discriminator": [
        95,
        129,
        237,
        240,
        8,
        49,
        223,
        132
      ],
      "accounts": [
        {
          "name": "launch",
          "writable": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              },
              {
                "kind": "account",
                "path": "buyer"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "buyer",
          "writable": true,
          "signer": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "claim",
      "docs": [
        "Buyer collects their allocation and any refund. Order account is closed."
      ],
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "launch",
          "relations": [
            "order"
          ]
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              },
              {
                "kind": "account",
                "path": "buyer"
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          },
          "relations": [
            "launch"
          ]
        },
        {
          "name": "buyerTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "buyer",
          "writable": true,
          "signer": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "claimCreator",
      "docs": [
        "Creator allocation, only after the lockup has passed."
      ],
      "discriminator": [
        231,
        240,
        197,
        249,
        244,
        10,
        21,
        59
      ],
      "accounts": [
        {
          "name": "launch",
          "writable": true
        },
        {
          "name": "mint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          },
          "relations": [
            "launch"
          ]
        },
        {
          "name": "creatorTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "creator",
          "writable": true,
          "signer": true,
          "relations": [
            "launch"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createLaunch",
      "docs": [
        "File a new agent IPO."
      ],
      "discriminator": [
        239,
        223,
        255,
        134,
        39,
        121,
        127,
        62
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "launchId"
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "poolTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "poolSolVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  115,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "metadata",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "tokenMetadataProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "account",
              "path": "tokenMetadataProgram"
            }
          }
        },
        {
          "name": "tokenMetadataProgram",
          "address": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "launchId",
          "type": "u64"
        },
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "symbol",
          "type": "string"
        },
        {
          "name": "saleSupply",
          "type": "u64"
        },
        {
          "name": "creatorSupply",
          "type": "u64"
        },
        {
          "name": "minPrice",
          "type": "u64"
        },
        {
          "name": "maxPrice",
          "type": "u64"
        },
        {
          "name": "lpBps",
          "type": "u16"
        },
        {
          "name": "roadshowSecs",
          "type": "i64"
        },
        {
          "name": "orderSecs",
          "type": "i64"
        },
        {
          "name": "lockSecs",
          "type": "i64"
        },
        {
          "name": "uri",
          "type": "string"
        }
      ]
    },
    {
      "name": "finalize",
      "docs": [
        "The opening bell. Anyone can ring it once the book has closed."
      ],
      "discriminator": [
        171,
        61,
        218,
        56,
        127,
        115,
        12,
        217
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "launch",
          "writable": true
        },
        {
          "name": "mint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          },
          "relations": [
            "launch"
          ]
        },
        {
          "name": "poolTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "poolSolVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  115,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "creator",
          "writable": true,
          "relations": [
            "launch"
          ]
        },
        {
          "name": "treasury",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "caller",
          "docs": [
            "Anyone can ring the bell."
          ],
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initConfig",
      "docs": [
        "One-time platform setup."
      ],
      "discriminator": [
        23,
        235,
        115,
        232,
        168,
        96,
        1,
        231
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasury"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "feeBps",
          "type": "u16"
        },
        {
          "name": "swapFeeBps",
          "type": "u16"
        },
        {
          "name": "minLockSecs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "migrateConfig",
      "docs": [
        "One-time upgrade of a config account created before `paused` existed."
      ],
      "discriminator": [
        92,
        131,
        58,
        105,
        210,
        154,
        224,
        193
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "placeOrder",
      "docs": [
        "Book-building: escrow SOL with a maximum acceptable price (as a tick index)."
      ],
      "discriminator": [
        51,
        194,
        155,
        175,
        109,
        130,
        96,
        106
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "launch",
          "writable": true
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              },
              {
                "kind": "account",
                "path": "buyer"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "budget",
          "type": "u64"
        },
        {
          "name": "maxTick",
          "type": "u8"
        }
      ]
    },
    {
      "name": "setPaused",
      "docs": [
        "Emergency switch. Blocks new launches, orders, the bell and trading.",
        "Claims and order cancellations always keep working."
      ],
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "swap",
      "docs": [
        "Trade against the launch's locked constant-product pool.",
        "`buy = true`: amount_in is lamports, output is tokens.",
        "`buy = false`: amount_in is token base units, output is lamports."
      ],
      "discriminator": [
        248,
        198,
        158,
        145,
        225,
        117,
        135,
        200
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "launch",
          "writable": true
        },
        {
          "name": "mint",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          },
          "relations": [
            "launch"
          ]
        },
        {
          "name": "poolTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "poolSolVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  115,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "launch"
              }
            ]
          }
        },
        {
          "name": "traderTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amountIn",
          "type": "u64"
        },
        {
          "name": "minOut",
          "type": "u64"
        },
        {
          "name": "buy",
          "type": "bool"
        }
      ]
    },
    {
      "name": "updateConfig",
      "docs": [
        "Admin can tune fees / minimum lockup (cannot touch existing launches' escrow)."
      ],
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "newTreasury"
        }
      ],
      "args": [
        {
          "name": "feeBps",
          "type": "u16"
        },
        {
          "name": "swapFeeBps",
          "type": "u16"
        },
        {
          "name": "minLockSecs",
          "type": "i64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "launch",
      "discriminator": [
        144,
        51,
        51,
        163,
        206,
        85,
        213,
        38
      ]
    },
    {
      "name": "order",
      "discriminator": [
        134,
        173,
        223,
        185,
        77,
        86,
        28,
        51
      ]
    }
  ],
  "events": [
    {
      "name": "bellRung",
      "discriminator": [
        48,
        5,
        119,
        174,
        235,
        88,
        206,
        242
      ]
    },
    {
      "name": "claimed",
      "discriminator": [
        217,
        192,
        123,
        72,
        108,
        150,
        248,
        33
      ]
    },
    {
      "name": "launchCreated",
      "discriminator": [
        59,
        38,
        190,
        230,
        33,
        34,
        89,
        20
      ]
    },
    {
      "name": "orderPlaced",
      "discriminator": [
        96,
        130,
        204,
        234,
        169,
        219,
        216,
        227
      ]
    },
    {
      "name": "pauseChanged",
      "discriminator": [
        238,
        188,
        213,
        78,
        134,
        209,
        178,
        218
      ]
    },
    {
      "name": "swapped",
      "discriminator": [
        217,
        52,
        52,
        83,
        147,
        135,
        96,
        109
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidParams",
      "msg": "Invalid parameters"
    },
    {
      "code": 6001,
      "name": "creatorShareTooHigh",
      "msg": "Creator allocation cannot exceed 25% of the sale supply"
    },
    {
      "code": 6002,
      "name": "lockTooShort",
      "msg": "Creator lockup is shorter than the platform minimum"
    },
    {
      "code": 6003,
      "name": "bookNotOpen",
      "msg": "The order book is not open yet (roadshow in progress)"
    },
    {
      "code": 6004,
      "name": "bookClosed",
      "msg": "The order book is closed"
    },
    {
      "code": 6005,
      "name": "bookStillOpen",
      "msg": "The order book is still open"
    },
    {
      "code": 6006,
      "name": "orderTooSmall",
      "msg": "Order below the 0.01 SOL minimum"
    },
    {
      "code": 6007,
      "name": "alreadyFinalized",
      "msg": "Launch already finalized"
    },
    {
      "code": 6008,
      "name": "notFinalized",
      "msg": "Launch not finalized yet"
    },
    {
      "code": 6009,
      "name": "alreadyClaimed",
      "msg": "Already claimed"
    },
    {
      "code": 6010,
      "name": "stillLocked",
      "msg": "Creator tokens are still locked"
    },
    {
      "code": 6011,
      "name": "nothingToClaim",
      "msg": "Nothing to claim"
    },
    {
      "code": 6012,
      "name": "poolEmpty",
      "msg": "Pool is empty"
    },
    {
      "code": 6013,
      "name": "slippage",
      "msg": "Price moved beyond your slippage limit"
    },
    {
      "code": 6014,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6015,
      "name": "paused",
      "msg": "Stewra is paused for maintenance. Claims and refunds still work."
    },
    {
      "code": 6016,
      "name": "unauthorized",
      "msg": "Not authorized"
    }
  ],
  "types": [
    {
      "name": "bellRung",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "clearingPrice",
            "type": "u64"
          },
          {
            "name": "tokensSold",
            "type": "u64"
          },
          {
            "name": "raised",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "claimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "tokens",
            "type": "u64"
          },
          {
            "name": "refund",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "swapFeeBps",
            "type": "u16"
          },
          {
            "name": "minLockSecs",
            "type": "i64"
          },
          {
            "name": "launchCount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "launch",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "launchId",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "saleSupply",
            "type": "u64"
          },
          {
            "name": "creatorSupply",
            "type": "u64"
          },
          {
            "name": "minPrice",
            "type": "u64"
          },
          {
            "name": "maxPrice",
            "type": "u64"
          },
          {
            "name": "lpBps",
            "type": "u16"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "roadshowEnd",
            "type": "i64"
          },
          {
            "name": "orderEnd",
            "type": "i64"
          },
          {
            "name": "lockSecs",
            "type": "i64"
          },
          {
            "name": "lockUntil",
            "type": "i64"
          },
          {
            "name": "bucketBudget",
            "type": {
              "array": [
                "u64",
                10
              ]
            }
          },
          {
            "name": "totalBudget",
            "type": "u64"
          },
          {
            "name": "orderCount",
            "type": "u32"
          },
          {
            "name": "finalized",
            "type": "bool"
          },
          {
            "name": "clearingTick",
            "type": "u8"
          },
          {
            "name": "clearingPrice",
            "type": "u64"
          },
          {
            "name": "eligibleBudget",
            "type": "u64"
          },
          {
            "name": "soldValue",
            "type": "u64"
          },
          {
            "name": "tokensSold",
            "type": "u64"
          },
          {
            "name": "creatorClaimed",
            "type": "bool"
          },
          {
            "name": "poolSol",
            "type": "u64"
          },
          {
            "name": "poolTokens",
            "type": "u64"
          },
          {
            "name": "volumeSol",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "poolSolBump",
            "type": "u8"
          },
          {
            "name": "mintBump",
            "type": "u8"
          },
          {
            "name": "poolTokensBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "launchCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "order",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "budget",
            "type": "u64"
          },
          {
            "name": "maxTick",
            "type": "u8"
          },
          {
            "name": "placedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "orderPlaced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "budget",
            "type": "u64"
          },
          {
            "name": "maxPrice",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "pauseChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "swapped",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "launch",
            "type": "pubkey"
          },
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "buy",
            "type": "bool"
          },
          {
            "name": "amountIn",
            "type": "u64"
          },
          {
            "name": "amountOut",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
