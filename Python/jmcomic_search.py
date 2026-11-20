import argparse
from jmcomic import JmOption


def main():
    parser = argparse.ArgumentParser(description='Search JMComic')
    parser.add_argument('search_query', help='JM 搜索词或作品 ID')
    query = parser.parse_args().search_query

    client = JmOption.default().new_jm_client()
    page = client.search_site(search_query=query, page=1)
    for album_id, title in page:
        print(f'[{album_id}]: {title}')


if __name__ == '__main__':
    main()
