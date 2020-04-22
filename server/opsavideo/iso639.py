import unicodedata


database = {
    "fra": { 'name': "French", 'titles': ["french", "francais"], 'alt': "fre" },
    "eng": { 'name': "English", 'titles': [] }
}

def from_title(query_title):
    # remove diacritics and convert to lowercase
    query_title = "".join(char for char in unicodedata.normalize('NFD', query_title) if unicodedata.category(char) != 'Mn').lower()

    for id, lang in database.items():
        for lang_title in lang['titles']:
            if lang_title in query_title:
                return id

    return "und"

